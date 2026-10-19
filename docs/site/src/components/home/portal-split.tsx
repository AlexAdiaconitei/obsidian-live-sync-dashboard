import { example } from '@/lib/shared';

/** The three HTTPS endpoints of the Tailscale node, one column each. */
const PORTALS = [
  {
    address: `https://${example.fqdn}`,
    name: 'Sync gateway',
    who: 'Obsidian clients',
    body: 'LiveSync syncs through the quota gateway, which refuses any write that would go over a storage limit.',
  },
  {
    address: `https://${example.fqdn}:8443`,
    name: 'Administration',
    who: 'Logins in PANEL_ADMINS',
    body: 'People, vaults, adopting existing databases, quotas, instance backups and the activity log.',
  },
  {
    address: `https://${example.fqdn}:9443`,
    name: 'Owner portal',
    who: 'Each person, with their own password',
    body: 'Their own vaults, sync password, device setup and personal Google Drive backups.',
  },
];

export function PortalSplit() {
  return (
    <div className="grid border-t border-ls-line md:grid-cols-3">
      {PORTALS.map((portal) => (
        <div
          key={portal.name}
          className="border-b border-ls-line py-6 md:border-l md:px-6 md:first:border-l-0 md:first:pl-0"
        >
          <p className="eyebrow">{portal.who}</p>
          <h3 className="mt-2 text-[1.05rem] font-semibold tracking-tight text-ls-ink">
            {portal.name}
          </h3>
          <code className="mt-2 block break-all font-mono text-[0.78rem] text-ls-accent">
            {portal.address}
          </code>
          <p className="mt-3 text-[0.875rem] leading-relaxed text-ls-muted">{portal.body}</p>
        </div>
      ))}
    </div>
  );
}
