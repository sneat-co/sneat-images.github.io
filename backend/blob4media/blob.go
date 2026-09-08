// Copyright 2026 Sneat.app

package blob4media

import (
	"context"
	"io"
	"time"
)

type UploadCapability struct {
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

type ImageInfo struct {
	ContentType string
	Size        int64
	Width       int
	Height      int
	SHA256      string
	Generation  int64
}

type Store interface {
	BeginResumableUpload(ctx context.Context, objectKey, contentType string, expiresAt time.Time) (UploadCapability, error)
	InspectImage(ctx context.Context, objectKey string, maxBytes int64) (ImageInfo, error)
	Open(ctx context.Context, objectKey string) (io.ReadCloser, error)
	Delete(ctx context.Context, objectKey string, generation int64) error
}
