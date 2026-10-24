# Security

## WAF Firewall

**Security → WAF Firewall** runs ModSecurity with the OWASP Core Rule Set in front of every website.

- **Blocking** or **detect only** (log, don't block) mode, and the rule level (paranoia).
- Ready-made exclusions for WordPress, Nextcloud, Drupal, DokuWiki, phpMyAdmin, phpBB and XenForo
  to avoid false alarms.
- Trusted IPs that are never blocked; a per-site off switch.
- **Recent attacks** shows what was blocked; **Allow this rule** fixes a false alarm in one click,
  **Ban** blocks the attacker.

## IP Blocker, Trust and the IP card

Clicking any IP address in the panel (visitors, errors, Network Monitor, WAF) opens the **IP card**:
who owns the address, its reverse DNS, what it did here (web requests, WAF hits, failed logins), and
buttons to **Ban**, **Unban**, **Trust**, **Untrust** and **Report**.

Bans are server-wide firewall (nftables) rules, so a banned IP can't reach any service. Every ban
records where it was made (IP card, Network Monitor, WAF, IP Blocker, another server) and shows it
in the IP Blocker. With [several servers](servers.md) a ban can be applied everywhere.

## Reporting abuse

**Report** prepares an abuse report for the network that owns the IP (its abuse contact from the
registry), with the evidence from this server's logs — failed logins and web attacks with times.
You see a preview, can change the recipient and add a note, and nothing is sent until you click
Send. An IP that was already reported is marked as such.

## fail2ban, SSH keys, two-factor login, API tokens

See the matching pages under Security; each explains its settings.
