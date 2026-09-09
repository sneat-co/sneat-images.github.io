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

Before deployment:

- Create a private, uniform-access GCS originals bucket and apply
  `infra/gcs-cors.json`.
- Set `MEDIA_GCS_BUCKET` to that bucket and `MEDIA_GCS_ACCESS_ID` to the upload
  signer service-account email. Enable the IAM Service Account Credentials API,
  grant the Sneat Go runtime service account `roles/iam.serviceAccountTokenCreator`
  on the signer, grant the signer `roles/storage.objectCreator` on the bucket,
  and grant the runtime `roles/storage.objectUser` on the bucket. Upload URL
  signatures are produced with IAM `signBlob`; do not create or configure a
  service-account private-key file.
- Store `MEDIA_ACCESS_PRIVATE_KEY` and `MEDIA_ORIGIN_SECRET` with the Sneat Go
  deployment. Configure the Worker with the matching `MEDIA_ACCESS_PUBLIC_KEY`
  and `MEDIA_ORIGIN_SECRET` secrets.
- Enable Cloudflare Image Transformations for the `sneat.co` zone. The
  `wrangler.jsonc` Images binding transforms successful protected-origin
  responses and preserves real origin error statuses. Keep the
  `media.sneat.co/m/*` Worker route on a proxied DNS hostname.

Secrets belong in the platform secret stores, never in `wrangler.jsonc` or
source control.
