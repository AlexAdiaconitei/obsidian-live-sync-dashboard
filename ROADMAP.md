# Roadmap

This file describes planned work. It is not a release promise and has no dates. Released changes are
in [CHANGELOG.md](CHANGELOG.md).

## Supported today: private deployment through Tailscale

The only supported deployment keeps the dashboard on a tailnet. Do not expose it to the public
internet, with or without Tailscale Funnel.

- **Administration** trusts the `Tailscale-User-Login` header that Tailscale Serve adds, and
  compares it with `PANEL_ADMINS`. There is no administrator password. A client that reaches the
  administration listener without Tailscale Serve in front can send that header and act as any
  administrator.
- **Owners** always sign in with their CouchDB username and sync password.
- **CouchDB and every backend listener** stay on loopback. Tailscale Serve publishes only the
  HTTPS endpoints, and Obsidian syncs through the quota gateway.
- **Attempt limits** are kept in memory per panel process, which is enough on a private network.

An authentication proxy in front of the panel, such as oauth2-proxy, Authelia or Cloudflare
Access, could remove the client's `Tailscale-User-Login` header and set its own. That setup is not
supported or tested, because the panel's security would then depend on the proxy configuration
alone.

## Planned: secure public deployment

The goal is that an operator can run the dashboard on the public internet, behind their own
HTTPS reverse proxy, without Tailscale and without weakening the private deployment.

### Deployment mode

- A new setting selects the deployment: `tailscale` (the current behaviour and the default) or
  `public`.
- In `public` mode the panel ignores Tailscale identity headers.
- In `tailscale` mode nothing changes for existing installations.

### Administrator sign-in

- Administrators sign in with a username and password. The panel stores only a memory-hard hash
  (scrypt or Argon2id) in its registry, never the password.
- A TOTP second factor is mandatory in `public` mode, with single-use recovery codes.
- The operator creates the first administrator with a one-time command on the server, never from
  an open web form. Administrators invite the others from the panel.
- Sessions use the same signed, `__Host-` prefixed, `Secure`, `HttpOnly` cookies as owners, with
  idle and absolute expiry. Changing a password or the second factor revokes every other session.
- Sign-in, password and second-factor changes, and revocations are recorded in the activity log.

### Owner sign-in

- An optional TOTP second factor can be turned on per owner, and required in `public` mode.
- Invitations keep their current single-use links that expire after 24 hours.

### Network exposure

- One HTTPS entry point at the operator's reverse proxy (Traefik, Caddy or nginx). The documented
  configurations terminate TLS, forward only the panel and gateway routes, and set HSTS.
- CouchDB stays private. Obsidian clients keep syncing through the quota gateway, which gains
  request-rate limits suited to an internet-facing endpoint.
- A `TRUSTED_PROXIES` setting decides which forwarded client addresses the panel believes, so attempt
  limits and the activity log use the real client address.

### Hardening

- Attempt limits and lockouts persist in the registry, so a restart does not reset them.
- Tests cover header spoofing in `public` mode, bootstrap, the second factor, session revocation
  and the limits, in the unit, CouchDB integration and browser suites.
- The security reference and the deployment guides get a public-deployment section with its threat
  model and the operator checklist.

Until this ships, deploy through Tailscale only.
