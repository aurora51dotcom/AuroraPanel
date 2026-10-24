# Certificates (AutoSSL)

**Security → AutoSSL** keeps a trusted Let's Encrypt certificate on every website and the mail host
name, and renews them before they expire.

## Turning it on

Let's Encrypt has its own [subscriber agreement](https://letsencrypt.org/repository/). AutoSSL stays
off until you tick that you accept it — the panel never accepts it for you. Add a contact email so
Let's Encrypt can warn you if a certificate is about to expire.

## What it does

- Every night (around 03:00) it looks at every site name and alias: names that point at this
  server and have no valid trusted certificate, or one with fewer than 20 days left, get a new one
  through `certbot` (HTTP validation in the site's folder), and the site switches to it.
- Names that point elsewhere are listed with the reason. A name that failed is retried the next
  day, never in a loop (Let's Encrypt limits failed attempts).
- The **mail host name** (e.g. `mail.example.com`) gets a certificate used by Postfix, Dovecot and
  the mail web pages.
- **Run now** does the same immediately, with a live log.

## Wildcard certificates

`*.example.com` can't be validated over HTTP; Let's Encrypt asks for a DNS TXT record. Wildcards
are available when this server answers DNS for the domain (Domains → Zone Editor): AutoSSL adds the
`_acme-challenge` record, waits until the nameservers show it, and removes it afterwards.

## Self-signed fallback

Until a trusted certificate exists, sites use a self-signed one so HTTPS still works (with a
browser warning).
