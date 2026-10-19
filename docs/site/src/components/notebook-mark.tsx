/**
 * The panel's mark: Phosphor's "notebook", the same glyph the application draws in its
 * sidebar (docs/images/mark.svg). Filled with currentColor so the caller picks the tone.
 */
export function NotebookMark({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M184,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h64A8,8,0,0,1,184,112Zm-8,24H112a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm48-88V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48ZM48,208H72V48H48Zm160,0V48H88V208H208Z" />
    </svg>
  );
}

/** The mark in the panel's soft accent tile, as it appears next to the product name. */
export function BrandTile({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-7 p-1', md: 'size-10 p-2', lg: 'size-14 p-2.5' }[size];
  return (
    <span className={`brand-tile shrink-0 ${box}`}>
      <NotebookMark className="size-full" />
    </span>
  );
}
