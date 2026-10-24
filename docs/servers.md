# Several servers

**System → Servers** shows every AuroraPanel you run on one page: status, load, memory, disk,
updates waiting and alerts, with a link to open each panel.

## Adding a server

1. On the other server, create an API token (**Security → API Tokens**).
2. Here, **Add server**: its address (`https://host:8088`) and the token.

The first connection remembers the other server's certificate fingerprint (trust on first use).
If the certificate later changes, the connection is refused until you re-confirm the server (after
a renewal) — so a self-signed panel certificate is still safe to use. Plain `http://` is only allowed for
private (LAN) addresses.

## Ban everywhere

Banning an IP from the IP card, the Network Monitor or the IP Blocker can be applied to **all
servers** at once; unbanning works the same way. Each server shows where the ban came from.

Removing a server here doesn't change the other server; revoke its token there too.
