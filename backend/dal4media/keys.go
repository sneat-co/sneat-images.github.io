// Copyright 2026 Sneat.app

package dal4media

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"github.com/dal-go/record"
	"github.com/sneat-co/sneat-ext-contracts/media/models4media"
	"github.com/sneat-co/sneat-images/backend/dbo4media"
)

func MediaID(userID, requestID string) string {
	sum := sha256.Sum256([]byte(userID + "\x00" + requestID))
	return "m_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func LinkID(target models4media.Target, role string) string {
	parts := []string{string(target.Scope), target.SpaceID, target.Type, target.ParentID, target.ID, role}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "l_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func NewMediaKey(mediaID string) *record.Key {
	return record.NewKeyWithID(dbo4media.MediaCollection, mediaID)
}
func NewLinkKey(mediaID, linkID string) *record.Key {
	return record.NewKeyWithParentAndID(NewMediaKey(mediaID), dbo4media.LinksCollection, linkID)
}

func NewMediaRecord(mediaID string, data *dbo4media.MediaAsset) record.Record {
	return record.NewRecordWithData(NewMediaKey(mediaID), data)
}

func NewLinkRecord(mediaID, linkID string, data *dbo4media.MediaLink) record.Record {
	return record.NewRecordWithData(NewLinkKey(mediaID, linkID), data)
}
