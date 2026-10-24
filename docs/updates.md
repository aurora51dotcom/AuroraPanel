# System updates

**System → Updates** lists waiting package updates, with security fixes marked, and installs them
with a live log. The list is refreshed every six hours in the background.

## Automatic updates

- **Security updates automatically** — uses Debian/Ubuntu's `unattended-upgrades`, limited to
  security fixes.
- **Everything automatically** — all updates, not only security fixes.
- **Restart automatically** when an update needs it, at a time you choose (default 04:00);
  otherwise the page and an alert tell you a restart is waiting.

The settings are written to `/etc/apt/apt.conf.d/20auto-upgrades` and `52aurora-unattended`.

## Restart

When an update needs a restart, the page says so. **Restart in 1 minute** restarts the server (the
panel comes back by itself); **Cancel a planned restart** stops one that's waiting.

If `apt` is busy (for example the nightly automatic update is running), the panel waits up to two
minutes for it instead of failing.
