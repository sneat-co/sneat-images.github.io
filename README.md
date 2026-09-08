# Sneat Co. image assets

This repository stores static image assets used by Sneat Co. web and product surfaces. It currently includes the coffee-and-laptop image shown below and CommittedMe onboarding artwork in the [`commitius/`](commitius/) directory.

![Coffee & laptop](coffe-and-laptop-1280x854.jpg)

## Shared media platform

The MVP implementation lives in three layers:

- `backend/` owns DALgo-backed media records, GCS original objects, upload
  finalization, links, lifecycle state, reconciliation, and access grants.
- `edge/` serves semantic image variants at `media.sneat.co` and verifies
  short-lived Ed25519 access tokens for private media.
- `infra/gcs-cors.json` is the browser-upload CORS policy for the originals
  bucket. Add each deployed application origin explicitly before applying it;
  GCS CORS does not support partial-domain wildcards.

The originals bucket must remain private. Browsers receive only a short-lived
resumable-upload capability from the Sneat Go media endpoints. Reads flow
through the Cloudflare Worker and its authenticated Sneat Go origin endpoint.

Before deployment, configure the Sneat Go media module with the GCS bucket,
signing key, edge-origin shared secret, and lifecycle schedule. Configure the
Worker with the matching Ed25519 public key and origin secret. Secrets belong
in the platform secret stores, never in `wrangler.jsonc` or source control.
