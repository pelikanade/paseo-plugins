Host monitor puts live CPU, memory and load average for the Paseo daemon host in the sidebar footer. It reads the daemon machine, not the device running the Paseo app.

A single footer row shows CPU usage, memory usage and the one-minute load average. Select it to open a popover with the one, five and fifteen minute load averages, memory used and total, logical core count, uptime, and a 60 second sparkline for each metric.

The server samples once per second and keeps the last minute in memory. The client refreshes every two seconds. Nothing is written to disk, sent over the network, or collected from the client device. CPU and memory values are percentages; warning and critical colors start at 70 percent and 90 percent. Load is colored by its one-minute value per logical core, with warning at 0.7 and critical at 1.0. Load averages are unavailable on Windows and appear as dashes.
