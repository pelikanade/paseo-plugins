# OMP optimize

Shows images that OMP read directly in the Paseo chat timeline.

OMP's `Read` tool reports an image as a text line such as `Read image file [image/png]`. Paseo's tool row keeps only that text, so the image itself never appears. This plugin turns the finished row into the image.

## How it works

A client timeline transformer watches completed `tool_call` rows whose detail is a read and whose content starts with `Read image file [image/...]`. It replaces that row with a plugin row carrying the file path, the original marker text and the dimensions OMP reported.

The renderer asks a daemon RPC for the file. The RPC resolves a relative path against the agent's working directory, reads at most 10 MiB, identifies PNG, JPEG, GIF, WebP, AVIF and BMP by signature with an extension fallback, and returns base64. The client displays it as a data URI, scaled to at most 560 by 480 pixels on desktop and 280 by 320 in the compact layout. If reading or decoding fails, the row falls back to OMP's original text plus the error.

The plugin reads the original file on the daemon host, not OMP's transcoded image blob. A PNG that OMP converts to WebP is therefore displayed from its source.

## Limits

- Only OMP image reads are replaced. Text reads, remote URLs and `xd://` device reads keep Paseo's normal rows.
- Images larger than 10 MiB are not loaded.
- The file must still exist when the row renders. Deleting it leaves the original marker and an error.
- The daemon reads the file with the permissions of the daemon user.

## Install

```sh
paseo plugin install "$PWD/plugins/paseo-omp-optimize"
paseo plugin ls
```
