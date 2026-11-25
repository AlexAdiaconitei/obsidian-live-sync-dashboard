// author-profile: the about card for React/Next landings (PageBox's Fumadocs site). Copy
// about.json and icons.ts next to it, alex.webp to public/, and import about-card.css once.
// The data is imported at build time, so a static export carries the text.
import about from './about.json';
import { ABOUT_ICONS } from './icons';

type Lang = 'en' | 'es';

export function AboutCard({ lang = 'en', photo = 'alex.webp' }: { lang?: Lang; photo?: string }) {
	return (
		<article className="about-card">
			<div className="about-photo-wrap">
				{/* eslint-disable-next-line @next/next/no-img-element -- static export, images are unoptimized */}
				<img
					src={photo}
					alt={about.name}
					className="about-photo"
					width={688}
					height={917}
					loading="lazy"
				/>
			</div>
			<div className="about-content">
				<p className="about-kicker">{lang === 'es' ? 'Creador' : 'Creator'}</p>
				<h3>{about.name}</h3>
				<p className="about-bio">{about.bio[lang]}</p>
				<ul className="about-facts">
					{about.facts[lang].map((fact) => (
						<li key={fact}>{fact}</li>
					))}
				</ul>
				<div className="about-links">
					{about.links.map((link) => (
						<a key={link.url} href={link.url} target="_blank" rel="noreferrer">
							<span
								style={{ display: 'contents' }}
								// Static icons from icons.ts, never user data.
								dangerouslySetInnerHTML={{ __html: ABOUT_ICONS[link.icon] ?? '' }}
							/>
							{link.label}
						</a>
					))}
				</div>
			</div>
		</article>
	);
}
