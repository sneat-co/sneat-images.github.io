// Copyright 2026 Sneat.app

package facade4media

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"io"
	"testing"
	"time"

	"github.com/dal-go/dalgo/dal"
	"github.com/sneat-co/sneat-ext-contracts/media/models4media"
	"github.com/sneat-co/sneat-go-core/sneatcoretesting"
	"github.com/sneat-co/sneat-images/backend/blob4media"
)

type fakeBlob struct {
	info    blob4media.ImageInfo
	deleted bool
}

func (f *fakeBlob) BeginResumableUpload(_ context.Context, _ string, _ string, expires time.Time) (blob4media.UploadCapability, error) {
	return blob4media.UploadCapability{URL: "https://storage.example/upload", Method: "POST", Headers: map[string]string{"x-goog-resumable": "start"}, ExpiresAt: expires}, nil
}
func (f *fakeBlob) InspectImage(context.Context, string, int64) (blob4media.ImageInfo, error) {
	return f.info, nil
}
func (f *fakeBlob) Open(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader([]byte("image"))), nil
}
func (f *fakeBlob) Delete(context.Context, string, int64) error { f.deleted = true; return nil }

type allowAll struct{}

func (allowAll) Authorize(context.Context, string, models4media.Target) error { return nil }

type fakeTargetAdapter struct{ refs map[string]*models4media.Ref }

func targetRefKey(target models4media.Target, role string) string {
	return target.SpaceID + "/" + target.Type + "/" + target.ParentID + "/" + target.ID + "/" + role
}

func (a *fakeTargetAdapter) Current(_ context.Context, _ dal.ReadwriteTransaction, target models4media.Target, role string) (*models4media.Ref, error) {
	return a.refs[targetRefKey(target, role)], nil
}

func (a *fakeTargetAdapter) Set(_ context.Context, _ dal.ReadwriteTransaction, target models4media.Target, role string, ref *models4media.Ref) error {
	key := targetRefKey(target, role)
	if ref == nil {
		delete(a.refs, key)
	} else {
		copy := *ref
		a.refs[key] = &copy
	}
	return nil
}

func TestMediaLifecycleReuseRestoreAndOrphanPurge(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	blob := &fakeBlob{info: blob4media.ImageInfo{ContentType: "image/jpeg", Size: 5, Width: 100, Height: 80, SHA256: HashBytes([]byte("image")), Generation: 7}}
	adapter := &fakeTargetAdapter{refs: map[string]*models4media.Ref{}}
	service := Service{DB: sneatcoretesting.NewMemoryDB(), Blob: blob, Bucket: "private-media", Adapters: map[string]TargetAdapter{"contact": adapter}, Authorizer: allowAll{}, Now: func() time.Time { return now }, Recovery: time.Hour, OrphanGrace: time.Hour}
	begin, err := service.BeginUpload(context.Background(), "u1", BeginUploadRequest{RequestID: "req-1", ContentType: "image/jpeg", Size: 5, Access: models4media.AccessPrivate})
	if err != nil {
		t.Fatal(err)
	}
	if begin.UploadMethod != "POST" || begin.MediaID == "" {
		t.Fatalf("unexpected upload response: %+v", begin)
	}
	if _, err = service.FinalizeUpload(context.Background(), "u1", FinalizeUploadRequest{MediaID: begin.MediaID, SHA256: blob.info.SHA256}); err != nil {
		t.Fatal(err)
	}
	target1 := models4media.Target{Scope: models4media.TargetScopeSpace, SpaceID: "s1", Type: "contact", ID: "c1"}
	target2 := models4media.Target{Scope: models4media.TargetScopeSpace, SpaceID: "s2", Type: "contact", ID: "c2"}
	for i, target := range []models4media.Target{target1, target2} {
		result, linkErr := service.Link(context.Background(), "u1", LinkRequest{RequestID: string(rune('a' + i)), MediaID: begin.MediaID, Target: target, Role: "avatar", Crop: &models4media.Crop{CenterX: .5, CenterY: .5, Zoom: 1}})
		if linkErr != nil {
			t.Fatal(linkErr)
		}
		if result.RefCount != i+1 {
			t.Fatalf("ref count=%d, want %d", result.RefCount, i+1)
		}
	}
	removed, err := service.Unlink(context.Background(), "u1", target1, "avatar")
	if err != nil {
		t.Fatal(err)
	}
	if removed.RefCount != 1 || removed.DurableRefCount != 2 || removed.Status != models4media.LinkStatusDeleted {
		t.Fatalf("unexpected removed result: %+v", removed)
	}
	adapter.refs[targetRefKey(target1, "avatar")] = &models4media.Ref{MediaID: "m_replacement"}
	if _, err = service.Restore(context.Background(), "u1", begin.MediaID, target1, "avatar"); err == nil {
		t.Fatal("expected restore to reject replacing a newer active reference")
	}
	delete(adapter.refs, targetRefKey(target1, "avatar"))
	if _, err = service.Restore(context.Background(), "u1", begin.MediaID, target1, "avatar"); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Unlink(context.Background(), "u1", target1, "avatar"); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Unlink(context.Background(), "u1", target2, "avatar"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	sweep, err := service.Sweep(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if sweep.LinksPurged != 2 {
		t.Fatalf("links purged=%d, want 2", sweep.LinksPurged)
	}
	asset, err := service.GetAsset(context.Background(), begin.MediaID)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Status != models4media.AssetStatusOrphaned || asset.DurableRefCount != 0 {
		t.Fatalf("asset not orphaned: %+v", asset)
	}
	now = now.Add(2 * time.Hour)
	sweep, err = service.Sweep(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if sweep.AssetsPurged != 1 {
		t.Fatalf("assets purged=%d, want 1", sweep.AssetsPurged)
	}
	if !blob.deleted {
		t.Fatal("expected GCS object deletion")
	}
}

func TestBeginUploadIsIdempotentAndRejectsChangedShape(t *testing.T) {
	service := Service{DB: sneatcoretesting.NewMemoryDB(), Blob: &fakeBlob{}, Bucket: "b", Now: func() time.Time { return time.Now() }}
	request := BeginUploadRequest{RequestID: "same", ContentType: "image/png", Size: 1, Access: models4media.AccessPublic}
	first, err := service.BeginUpload(context.Background(), "u1", request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.BeginUpload(context.Background(), "u1", request)
	if err != nil {
		t.Fatal(err)
	}
	if first.MediaID != second.MediaID {
		t.Fatal("idempotent request produced different media IDs")
	}
	request.Size = 2
	if _, err = service.BeginUpload(context.Background(), "u1", request); err == nil {
		t.Fatal("expected changed idempotency shape to fail")
	}
}

func TestSweepPurgesStaleUpload(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	blob := &fakeBlob{}
	service := Service{DB: sneatcoretesting.NewMemoryDB(), Blob: blob, Bucket: "b", Now: func() time.Time { return now }, UploadGrace: time.Hour}
	begin, err := service.BeginUpload(context.Background(), "u1", BeginUploadRequest{RequestID: "stale", ContentType: "image/png", Size: 1, Access: models4media.AccessPrivate})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	result, err := service.Sweep(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if result.StaleUploadsPurged != 1 || !blob.deleted {
		t.Fatalf("unexpected stale upload sweep: %+v deleted=%v", result, blob.deleted)
	}
	asset, err := service.GetAsset(context.Background(), begin.MediaID)
	if err != nil {
		t.Fatal(err)
	}
	if asset.Status != models4media.AssetStatusFailed {
		t.Fatalf("status=%q, want failed", asset.Status)
	}
}

func TestAccessTokenUsesDefaultClockAndRestoreRequiresMediaID(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	service := Service{AccessKey: privateKey}
	token, expiresAt, err := service.AccessToken("u1", "media1", models4media.Target{Scope: models4media.TargetScopeRoot, Type: "user", ID: "u1"}, 0)
	if err != nil || token == "" || expiresAt.IsZero() {
		t.Fatalf("token=%q expires=%v err=%v", token, expiresAt, err)
	}
	request := RestoreRequest{TargetRequest: TargetRequest{Target: models4media.Target{Scope: models4media.TargetScopeRoot, Type: "user", ID: "u1"}, Role: "avatar"}}
	if err := request.Validate(); err == nil {
		t.Fatal("expected restore without mediaID to fail")
	}
}

func TestMutationRequiresConfiguredAuthorizer(t *testing.T) {
	service := Service{}
	target := models4media.Target{Scope: models4media.TargetScopeRoot, Type: "user", ID: "u1"}
	if _, err := service.Unlink(context.Background(), "u1", target, "avatar"); err == nil {
		t.Fatal("expected unlink without an authorizer to fail")
	}
	if _, err := service.Restore(context.Background(), "u1", "media1", target, "avatar"); err == nil {
		t.Fatal("expected restore without an authorizer to fail")
	}
}
