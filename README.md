# Family Hub

A Chinese, responsive, offline-capable family finance PWA. This repository publishes application code only. It contains no household budgets, balances, transaction records, passwords, or personal initialization files.

On first use, create an encrypted device space. Financial records are stored in IndexedDB as AES-GCM ciphertext and remain on the device. Optional end-to-end encrypted synchronization links devices with a private pairing code. Device unlock passwords and cloud encryption keys are never uploaded. Each device uploads immutable encrypted version files; a client-side causal merge preserves concurrent edits until explicit resolution. The cloud backend must be configured and deployed before pairing. Encrypted exports exclude synchronization credentials. Passwords cannot be recovered.

Serve this directory over HTTPS. On iPhone, open the deployed site in Safari and choose Share → Add to Home Screen. First complete online loading before offline use. The application includes a web app manifest, standalone display mode, app icons, and a scoped service worker.

Excel import/export uses bundled SheetJS CE 0.20.3. See `vendor/SheetJS-LICENSE.txt`.
