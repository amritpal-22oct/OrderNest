// Small inline icon set for the admin orders page — no icon library in this
// app (menu categories use emoji instead, see RestaurantMenu.tsx), and this
// is the first place plain nav/contact text needed icon treatment. Kept as
// one file rather than growing SelectChevron-style one-offs in page.tsx.
type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className ?? "h-4 w-4"}>
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h3a1 1 0 001-1v-3h2v3a1 1 0 001 1h3a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </Icon>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M10 18s6-5.686 6-10A6 6 0 004 8c0 4.314 6 10 6 10zm0-7a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
    </Icon>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M17.707 9.293L10.414 2H4a2 2 0 00-2 2v6.414l7.293 7.293a1 1 0 001.414 0l7-7a1 1 0 000-1.414zM6 6a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
    </Icon>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5a1 1 0 00-1 1v7a1 1 0 001 1h.101a2.5 2.5 0 014.798 0h4.202a2.5 2.5 0 014.798 0H17a1 1 0 001-1V9.5a1 1 0 00-.2-.6l-2.5-3.333A1 1 0 0014.5 5H3z" />
      <path d="M6.5 16a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM15.5 16a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
    </Icon>
  );
}

export function BagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M6 6V5a4 4 0 118 0v1h2a1 1 0 011 1v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7a1 1 0 011-1h2zm2-1a2 2 0 114 0v1H8V5zm0 4a1 1 0 012 0 2 2 0 104 0 1 1 0 112 0 4 4 0 01-8 0z" clipRule="evenodd" />
    </Icon>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v1H2V5z" />
      <path fillRule="evenodd" d="M18 8H2v6a2 2 0 002 2h12a2 2 0 002-2V8zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1z" clipRule="evenodd" />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M3 3a1 1 0 011-1h6a1 1 0 110 2H5v12h5a1 1 0 110 2H4a1 1 0 01-1-1V3zm10.293 3.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L14.586 11H8a1 1 0 110-2h6.586l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.94 5.94a2 2 0 011.06-.94h12a2 2 0 011.06.94L10 10.72 2.94 5.94z" />
      <path d="M18 7.24l-7.4 5.07a1 1 0 01-1.2 0L2 7.24V14a2 2 0 002 2h12a2 2 0 002-2V7.24z" />
    </Icon>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 2A1.5 1.5 0 002 3.5v1.148c0 7.663 6.19 13.852 13.852 13.852H17.5a1.5 1.5 0 001.5-1.5v-2.15a1.5 1.5 0 00-1.212-1.472l-3.09-.618a1.5 1.5 0 00-1.598.78l-.494.988a10.86 10.86 0 01-5.435-5.435l.988-.494a1.5 1.5 0 00.78-1.598l-.618-3.09A1.5 1.5 0 005.65 2H3.5z" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.328a1 1 0 01-1.414 1.414l-3.328-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </Icon>
  );
}

export function RefundIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path fillRule="evenodd" d="M4.343 4.343A8 8 0 1116.657 10a1 1 0 11-2 0 6 6 0 10-1.757 4.243l1.05-1.05a.5.5 0 01.854.353v3.408a.5.5 0 01-.5.5H11a.5.5 0 01-.354-.854l.913-.913A8 8 0 014.343 4.343z" clipRule="evenodd" />
    </Icon>
  );
}
