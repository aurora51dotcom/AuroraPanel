# Users and roles

**System → Panel Users** adds more people than the owner. Each person signs in with their own
name and password; their role is checked on every request, so changing or disabling someone takes
effect immediately (their open sessions stop working).

| Role | Can do |
| ---- | ------ |
| **Administrator** | Everything. The owner created at first run is always an administrator. |
| **Viewer** | Open every page and read status, logs and settings. Can't change anything, can't download files or backups, can't read passwords, keys or tokens, no terminal. |
| **Website manager** | Only the websites assigned to them: their **My Websites** home, the File Manager limited to those sites' folders, email accounts on those domains, and the sites' visitors, analytics and errors. Nothing else on the server is visible. |

Access is deny-by-default: a page or action that isn't explicitly allowed for a role is refused
(and the refusal is written to the activity log).

Notes

- Two-factor login (TOTP) is for the owner account.
- The browser terminal is administrator-only.
- Website managers can change their own password from the account menu.
- Files a website manager uploads to an [isolated site](isolation.md) are owned by that site's user.
