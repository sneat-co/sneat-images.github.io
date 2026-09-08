---
format: https://specscore.md/plan-specification
status: Draft
---

# Plan: Shared media platform MVP

**Status:** Draft
**Source Feature:** shared-media-platform
**Date:** 2026-09-08
**Owner:** alex
**Supersedes:** —

## Summary

Deliver the shared media contract, DALgo-backed backend, GCS upload boundary,
Cloudflare delivery Worker, reusable Angular/Ionic UI, and the four vertical
integrations. The global user avatar is the reference slice; the remaining
integrations follow only after its contract and UI are consolidated.

## Approach

Keep originals immutable in private GCS and domain identity in DALgo. The media
module owns records/lifecycle/API and calls narrow target adapters during the
same DALgo transaction as link changes; `sneat-go` only wires DB, GCS, signing,
authorization and target adapters. The frontend exposes a provider-neutral
service and shared picker/editor/thumbnail/viewer. OCR, general file handling,
global binary deduplication, galleries, and an admin retention UI remain out of
scope.

## Tasks

### Task 1: Shared contract and DALgo store

**Verifies:** shared-media-platform#ac:dalgo-media-graph
**Status:** in_progress

Define media/target/crop/upload DTOs, validated DBOs, deterministic keys, and a
DALgo store/service with transaction tests for reuse, unlink, restore, orphaning,
and idempotent retries.

### Task 2: GCS upload and validation

**Verifies:** shared-media-platform#ac:upload-finalize
**Status:** planning

Issue resumable initiation URLs through a blob-storage port, then validate the
actual stored image and finalize its immutable metadata.

### Task 3: Cloudflare serving and private tokens

**Verifies:** shared-media-platform#ac:private-edge-delivery
**Status:** planning

Implement named variants, Ed25519 verification, token-free cache identity,
authenticated origin streaming, configuration, and Worker tests.

### Task 4: Shared frontend and global avatar

**Verifies:** shared-media-platform#ac:global-avatar
**Status:** planning

Build the shared picker/editor/uploader/thumbnail/viewer and use it on My profile
with disabled in-progress controls, visible errors, replace/remove, and Undo.

### Task 5: Contact avatar override

**Verifies:** shared-media-platform#ac:contact-avatar-override
**Status:** planning

Add a Space-contact forward reference and integrate the shared avatar UI with
the override → global avatar → initials fallback.

### Task 6: Asset and document images

**Verifies:** shared-media-platform#ac:asset-images
**Status:** planning

Add ordered media references and primary preview to Assetus and wire thumbnail,
preview, large view, unlink, and restore through the shared service.

### Task 7: List-item photo

**Verifies:** shared-media-platform#ac:list-item-photo
**Status:** planning

Add one media reference to embedded Listus items and wire the shared capture,
upload, row thumbnail, preview, replace, remove, and restore flow.

### Task 8: Cleanup and reconciliation

**Verifies:** shared-media-platform#ac:recover-and-reconcile
**Status:** planning

Provide idempotent abandoned-upload and orphan cleanup plus diagnostics for
missing objects and reference-count drift.

### Task 9: Production composition and journey verification

**Verifies:** shared-media-platform#ac:global-avatar, shared-media-platform#ac:contact-avatar-override, shared-media-platform#ac:asset-images, shared-media-platform#ac:list-item-photo
**Status:** planning

Wire only composition in `sneat-go`, run focused module/component tests and a
real emulator/browser journey across all four integrations, then compare the
implementations for duplicated upload, URL, viewer, lifecycle, and crop logic.

## Open Questions

None at this time.

---
*This document follows the https://specscore.md/plan-specification*
