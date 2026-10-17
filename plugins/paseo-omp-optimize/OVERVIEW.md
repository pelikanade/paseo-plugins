Paseo keeps only the text line from an OMP image read, so the picture is missing from the conversation. This plugin detects those finished OMP read rows and replaces each with the actual image.

It reads the original file from the daemon host through a plugin RPC, so the displayed image is the source file rather than OMP's transcoded blob. Relative paths resolve against the agent's working directory. PNG, JPEG, GIF, WebP, AVIF and BMP up to 10 MiB are supported. If the file is missing, too large, or cannot be decoded by the client, the row shows OMP's original text and the error instead.
