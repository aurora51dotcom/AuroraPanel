# Per-site isolation

By default every website's PHP runs as `www-data`, so a hacked WordPress on one site could read or
change every other site. **Security → Site Isolation** gives a site its own walls:

- its own Linux user and group (`site_<name>`), owning the site's files;
- its own PHP-FPM pool running as that user, with `open_basedir` limited to the site's folder and
  dangerous functions (`exec`, `system`, `shell_exec`, …) disabled;
- the folder set to `750` with the group set, so other sites (and their PHP) can't read it.

Apache serves the site through that pool; the rest of the server is unaffected.

**Turn off** puts the site back exactly as it was: files owned by `www-data`, the pool removed, the
site user and group deleted.

## Things to know

- Isolation needs PHP-FPM for the PHP version Apache uses; the page installs it if missing. Sites
  that aren't isolated keep running as before.
- `exec`, `passthru`, `shell_exec`, `system`, `proc_open`, `popen` and `pcntl_exec` are disabled.
  Plugins that run shell commands (some backup or image plugins) won't be able to; if a site really
  needs one, edit `disable_functions` in its pool file
  (`/etc/php/<version>/fpm/pool.d/aurora-<site>.conf`) and reload PHP-FPM.
- Files uploaded through the File Manager (by you or a website manager) are given to the site user.
- Check a site after isolating it; anything writing outside its own folder will now be refused,
  which is the point.
