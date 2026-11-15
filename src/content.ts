/** Single source of truth for everything shown on the page and in AR. */

export interface LinkItem {
  id: string;
  label: string;
  href: string;
  /** Short text shown under the label on the 2D page. */
  hint: string;
  external: boolean;
}

export interface Project {
  id: string;
  name: string;
  blurb: string;
  href: string;
}

export const person = {
  name: 'Ashis Wadhwani',
  role: 'Platform, DevOps & Cloud Engineer',
  place: 'Mumbai',
  tagline: 'Point your phone at my business card',
} as const;

export const links: readonly LinkItem[] = [
  { id: 'portfolio', label: 'Portfolio', href: 'https://www.ashiswadhwani.in', hint: 'ashiswadhwani.in', external: true },
  { id: 'github', label: 'GitHub', href: 'https://github.com/ashis05', hint: 'ashis05', external: true },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/ashis-wadhwani-/', hint: 'ashis-wadhwani-', external: true },
  { id: 'email', label: 'Email', href: 'mailto:hello@ashiswadhwani.in', hint: 'hello@ashiswadhwani.in', external: false },
  { id: 'cv', label: 'CV', href: 'https://www.ashiswadhwani.in/Ashis_Wadhwani_CV.pdf', hint: 'PDF', external: true },
];

export const projects: readonly Project[] = [
  { id: 'vulcan', name: 'Vulcan', blurb: 'AI fitness app that logs meals from a photo.', href: 'https://www.ashiswadhwani.in/projects/vulcan' },
  { id: 'datum', name: 'Datum', blurb: 'Describe a part in plain English, get an exact 3D solid.', href: 'https://www.ashiswadhwani.in/projects/datum' },
  { id: 'fukidashi', name: 'Fukidashi', blurb: 'Chrome extension that translates manga in place.', href: 'https://www.ashiswadhwani.in/projects/fukidashi' },
];

export const assets = {
  target: '/targets/card.mind',
  video: '/media/card-loop.mp4',
} as const;
