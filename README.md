# SanFen

## Running locally

Copy `chess-helper.js` into the browser console on chess.com.

## Resolving merge conflicts for this helper

When you merge updates to `chess-helper.js`, Git may display conflict markers that offer three choices in your editor:

* **Accept current change** – keeps the code that already exists on the branch you have checked out locally.
* **Accept incoming change** – keeps the code that is coming from the branch you are merging in (typically the newer code from the remote).
* **Accept both changes** – keeps both variants, which often requires additional manual editing.

If you simply want to keep the newest version of the helper that you are pulling in from another branch or remote, choose **Accept incoming change**. That option discards the older local section and preserves the updated code so you can continue with the merge using the latest helper logic.
