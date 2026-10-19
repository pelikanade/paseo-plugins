OMP optimize closes gaps between what an OMP session produces and what Paseo's generic session and timeline model shows, so OMP inside Paseo keeps the fidelity and ergonomics it has when run directly. It addresses OMP-specific behavior only, not general Paseo UI.

The first gap is tool intent. OMP labels every tool call with a short intent, and Paseo drops it. During a live turn the plugin tails the OMP session JSONL, waits for the matching tool row, and appends a muted intent row after it. Imported sessions are not backfilled, and the rows are lost on daemon restart.

The second gap is image reads. Paseo keeps only the text line from an OMP image read, so the picture is missing from the conversation. This plugin detects those finished OMP read rows and replaces each with the actual image.

It reads the original file from the daemon host through a plugin RPC, so the displayed image is the source file rather than OMP's transcoded blob. Relative paths resolve against the agent's working directory. PNG, JPEG, GIF, WebP, AVIF and BMP up to 10 MiB are supported. If the file is missing, too large, or cannot be decoded by the client, the row shows OMP's original text and the error instead.
