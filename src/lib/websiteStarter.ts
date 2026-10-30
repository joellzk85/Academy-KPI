// The designed website (Joel, 2026-10-30; docs/features/website.md): the pages, copy, photos and menu loaded by
// Website → Pages → "Load the designed pages". Copy rewritten from the old WordPress site; photos are Next Academy's
// own (from the old site) or AI-made in Canva. Files sit in public/site-assets/starter/ and are copied into
// Website → Media on loading, so they can be replaced like any other photo. Company details are never typed here:
// the Contact block and the footer print them from lib/company.ts.
import type { MenuItem, PageData } from './website';

export type StarterPhoto = { id: string; file: string; name: string; folder: string; alt: string; tags: string[]; focusX?: number; focusY?: number };
export type StarterVideo = { id: string; youtubeId: string; name: string };

export const STARTER_PHOTOS: StarterPhoto[] = [
  { id: 'starter-hero', file: 'hero.jpg', name: 'Workshop around a flip chart', folder: 'Homepage', alt: 'A trainer leads a group of Malaysian professionals in a hands-on workshop around a flip chart', tags: ['ai', 'workshop'] },
  { id: 'starter-trainer-stage', file: 'trainer-stage.jpg', name: 'Trainer on stage', folder: 'Training days', alt: 'A Next Academy trainer teaching with a microphone in front of a flip chart', tags: ['trainer'], focusX: 55, focusY: 40 },
  { id: 'starter-team-work', file: 'team-work.jpg', name: 'Team working together', folder: 'Homepage', alt: 'The Next Academy team working together around a table', tags: ['team'] },
  { id: 'starter-workshop-group', file: 'workshop-group.jpg', name: 'Workshop circle', folder: 'Training days', alt: 'Participants standing in a circle during a Next Academy workshop', tags: ['workshop'] },
  { id: 'starter-office', file: 'office.jpg', name: 'Our office', folder: 'Other', alt: 'The Next Academy office in Petaling Jaya', tags: ['office'], focusX: 45 },
  { id: 'starter-esg-environment', file: 'esg-environment.jpg', name: 'ESG: environmental sustainability', folder: 'Programmes', alt: 'Employees planting seedlings and composting in a garden workshop', tags: ['ai', 'esg'] },
  { id: 'starter-esg-social', file: 'esg-social.jpg', name: 'ESG: social responsibility', folder: 'Programmes', alt: 'Colleagues sitting in a circle having an open discussion', tags: ['ai', 'esg'] },
  { id: 'starter-esg-governance', file: 'esg-governance.jpg', name: 'ESG: governance and ethics', folder: 'Programmes', alt: 'Managers reviewing policy documents in a boardroom workshop', tags: ['ai', 'esg'] },
  { id: 'starter-esg-team', file: 'esg-team.jpg', name: 'ESG: team dynamics', folder: 'Programmes', alt: 'Colleagues building a tower together during a team building activity', tags: ['ai', 'esg', 'team-building'] },
  { id: 'starter-skills-business', file: 'skills-business.jpg', name: 'Skills: business efficiency', folder: 'Programmes', alt: 'A trainer helping participants work with charts on their laptops', tags: ['ai', 'skills'] },
  { id: 'starter-skills-service', file: 'skills-service.jpg', name: 'Skills: customer service', folder: 'Programmes', alt: 'Hotel front desk staff practising guest service in a role-play', tags: ['ai', 'skills'] },
  { id: 'starter-skills-leadership', file: 'skills-leadership.jpg', name: 'Skills: leadership', folder: 'Programmes', alt: 'A manager practising a presentation to colleagues in a leadership workshop', tags: ['ai', 'skills'] },
  { id: 'starter-skills-safety', file: 'skills-safety.jpg', name: 'Skills: operations and safety', folder: 'Programmes', alt: 'Workers in safety vests practising with a fire extinguisher', tags: ['ai', 'skills', 'safety'] },
];

// Client testimonials already on Next Academy's YouTube channel.
export const STARTER_VIDEOS: StarterVideo[] = [
  { id: 'starter-video-hla', youtubeId: 'XOTmos8ohPw', name: 'Julie and Jonathan, HLA Garment' },
  { id: 'starter-video-impiana', youtubeId: 'tHxRjyMqC9k', name: 'Bell, Impiana Hotel KLCC' },
  { id: 'starter-video-trinitium', youtubeId: 'UolMLj4fkak', name: 'Han, Trinitium' },
];

let n = 0;
const block = (type: string, props: Record<string, any>) => ({ type, props: { id: `${type}-design-${++n}`, ...props } });
const heading = (eyebrow: string, heading: string, highlight = '', size = 'medium') => block('HeadingBlock', { eyebrow, heading, highlight, size, align: 'left' });
const text = (body: string) => block('TextBlock', { body });
const photo = (image: string, look = 'plain', height = 'medium', caption = '') => block('ImageBlock', { image, caption, look, height });
const button = (label: string, link: string, look = 'blue') => block('ButtonBlock', { label, link, look, align: 'left' });
const video = (v: StarterVideo) => block('VideoBlock', { video: v.id, caption: v.name });
const columns = (split: number, col1: any[], col2: any[], col3: any[] = []) => block('Columns', { count: col3.length ? '3' : '2', split, col1, col2, col3 });
const section = (background: string, content: any[], width = 'normal') => block('Section', { background, spacing: 'l', width, texture: background === 'white' ? 'no' : 'yes', content });
const page = (pageTitle: string, description: string, content: any[]): PageData => ({ root: { props: { pageTitle, description } }, content });
const list = (items: string[]) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

const contact = (eyebrow: string, heading: string, text: string, background = 'light') => block('Contact', { eyebrow, heading, text, background });
const CONTACT_TEXT = "Tell us about your team and what you'd like to change. We'll come back with a programme that fits, and show you how to claim it through HRD Corp.";

type Category = { title: string; intro: string; courses: string[]; image: string };

function categorySections(cats: Category[]) {
  return cats.map((c, i) => {
    const words = [
      heading(String(i + 1).padStart(2, '0'), c.title),
      text(`<p>${c.intro}</p>${list(c.courses)}`),
      button('Ask about these programmes', '#contact', i % 2 ? 'dark' : 'blue'),
    ];
    const pic = [photo(c.image, i % 2 ? 'torn' : 'frame', 'medium')];
    // Photo left, then right: easier on the eye down a long page. Phones show both one under the other.
    return section(i % 2 ? 'light' : 'white', [i % 2 ? columns(55, words, pic) : columns(45, pic, words)]);
  });
}

function home(): PageData {
  const [hla, impiana, trinitium] = STARTER_VIDEOS;
  return page('Next Academy | HRD Corp claimable training and coaching in Malaysia',
    'Practical, personalised training and coaching for Malaysian teams. ESG and professional skills programmes, in-house or public, HRD Corp claimable.', [
      block('Hero', {
        eyebrow: 'HRD Corp registered training provider',
        headline: "Behind every great employee is a trainer who didn't use", highlight: '100 slides.', headlineEnd: '',
        text: 'Practical, personalised training and coaching for Malaysian teams. Less lecturing, more doing, so new habits show up at work the very next day.',
        button1Label: 'See the training calendar', button1Link: '/training-calendar', button2Label: 'Plan a training with us', button2Link: '#contact',
        image: 'starter-hero', imageStyle: 'frame', background: 'dark',
      }),
      block('LogoStrip', { label: 'Trusted by teams at', items: [{ name: 'HLA Garment', image: '' }, { name: 'Impiana Hotel KLCC', image: '' }, { name: 'Trinitium', image: '' }] }),
      section('white', [columns(50,
        [photo('starter-workshop-group', 'torn', 'tall')],
        [
          heading('01 / Who we are', "More than a training provider. We're your", 'growth partner.'),
          text('<p>Next Academy is registered with HRD Corp Malaysia. We connect the right trainers with the right training, so every programme fits your people, your industry and where your business is heading.</p><p>Our promise is in our tagline: <strong>Unlocking Talents</strong>. We help good teams become remarkable ones, and help leaders build businesses that do good and last.</p>'),
          button('More about us', '/about-us', 'dark'),
        ])]),
      block('Points', {
        eyebrow: '02 / Why Next Academy', heading: 'Training that sticks, because it is', highlight: 'built around you.', background: 'light',
        items: [
          { title: 'Personalised', text: 'No two teams are the same. We shape every programme around your goals, your industry and your people, so the learning lands where it matters.' },
          { title: 'Purpose-driven', text: 'Everything we teach is anchored in integrity and real impact. Your people grow, and so does the good your business does.' },
          { title: 'Holistic', text: 'Skills are only the start. We build ethical leadership, fresh thinking and a habit of learning that keeps going after the training day.' },
        ],
      }),
      block('Calendar', { eyebrow: '03 / Training calendar', heading: 'Upcoming public programmes', text: 'Join a public class with people from other companies. Most programmes are HRD Corp claimable.', only: 'all', count: 6, background: 'white' }),
      section('dark', [
        heading('04 / Programmes', 'Two tracks. One goal:', 'people who perform.'),
        columns(50,
          [photo('starter-esg-environment', 'plain', 'short'), heading('', 'ESG programmes', '', 'small'),
            text('<p>Environmental, social and governance skills for companies building a sustainable business: from composting workshops to the Employment Act and anti-bribery.</p>'),
            button('See ESG programmes', '/training-courses-esg', 'teal')],
          [photo('starter-skills-leadership', 'plain', 'short'), heading('', 'Professional skills', '', 'small'),
            text('<p>Leadership, customer service, business efficiency and workplace safety, tailored to your industry and run in-house or as public classes.</p>'),
            button('See professional programmes', '/training-courses', 'teal')]),
      ]),
      section('white', [
        heading('05 / What our clients say', 'Hear it from the people we', 'trained.'),
        columns(50, [video(hla)], [video(impiana)], [video(trinitium)]),
      ]),
      block('Trainers', { eyebrow: '06 / Our trainers', heading: 'Learn from people who have', highlight: 'done the work.', count: 4, background: 'light' }),
      block('ValuesBand', { label: 'Our HEART values', items: [{ word: 'Humility' }, { word: 'Expertise' }, { word: 'Accountability' }, { word: 'Remarkable' }, { word: 'Trustworthiness' }], background: 'blue' }),
      contact('07 / Talk to us', 'Schedule a session with our training experts.', CONTACT_TEXT),
    ]);
}

function about(): PageData {
  return page('About us | Next Academy',
    'Next Academy is a Malaysian training provider registered with HRD Corp. Our vision, mission and HEART values, and how we work.', [
      block('Hero', {
        eyebrow: 'About Next Academy', headline: 'We help people go to work', highlight: 'inspired.', headlineEnd: '',
        text: 'Next Academy is a Malaysian training provider registered with HRD Corp. Through personalised training and coaching, we help people and organisations lead with integrity, grow sustainably and take real action.',
        button1Label: 'See our programmes', button1Link: '/training-courses', button2Label: 'Talk to us', button2Link: '#contact',
        image: 'starter-trainer-stage', imageStyle: 'torn', background: 'light',
      }),
      section('white', [columns(50,
        [heading('Our vision', 'A world where people are inspired to go to work every day.')],
        [heading('Our mission', 'Helping organisations achieve unity by being purpose-driven and taking real action.')])]),
      section('light', [columns(45,
        [photo('starter-team-work', 'frame', 'tall')],
        [
          heading('What we believe', 'Doing good should be the', 'golden standard.'),
          text('<p>We put ESG values (environmental, social and governance) at the heart of every decision, action and ambition. Not as a report to file, but as the way a good business runs.</p><p>So every programme we design starts with one question: what will your people do differently at work next week, and who benefits?</p>'),
        ])]),
      block('Points', {
        eyebrow: 'Our HEART values', heading: 'Five values that shape', highlight: 'how we work.', background: 'white',
        items: [
          { title: 'Humility', text: "We listen first. Every team knows things we don't, and the best training starts from there." },
          { title: 'Expertise', text: 'Our trainers are HRD Corp accredited and bring real industry experience into the room.' },
          { title: 'Accountability', text: "We own the outcome, not just the training day. If it doesn't work at work, it doesn't count." },
          { title: 'Remarkable', text: 'We aim for training people talk about afterwards, for the right reasons.' },
          { title: 'Trustworthiness', text: 'We do what we say, protect what you share with us and keep our promises.' },
        ],
      }),
      section('dark', [columns(50,
        [
          heading('Unlocking Talents', 'The right trainer for the', 'right training.'),
          text("<p>We match each programme with a trainer who has done the job, not just studied it. Then we tailor the content to your industry, your people and your goals, and make the HRD Corp claim simple.</p>"),
          button('Meet our trainers', '/trainers', 'teal'),
        ],
        [photo('starter-workshop-group', 'plain', 'medium')])]),
      contact('Talk to us', 'Schedule a session with our training experts.', CONTACT_TEXT),
    ]);
}

function esg(): PageData {
  return page('ESG training programmes | Next Academy',
    'Practical ESG training in Malaysia: environmental sustainability, social responsibility, governance and ethics, team engagement. HRD Corp claimable.', [
      block('Hero', {
        eyebrow: 'Training programmes · ESG', headline: 'Build a business that does good and', highlight: 'does well.', headlineEnd: '',
        text: 'Practical ESG training for companies on the way to sustainable growth. Environmental, social and governance skills your people can use straight away, from beginner to advanced, in-house or public.',
        button1Label: 'Ask about a programme', button1Link: '#contact', button2Label: 'See the training calendar', button2Link: '/training-calendar',
        image: 'starter-workshop-group', imageStyle: 'frame', background: 'dark',
      }),
      ...categorySections([
        { title: 'Environmental sustainability', image: 'starter-esg-environment', intro: 'Hands-on programmes that turn green intentions into daily habits, from the garden to the plant room.',
          courses: ['Soil Building through Composting', 'Planting Workshop: Activation Sustainability', 'Essential Knowledge for Solar PV System Operation & Maintenance', 'Unlocking Organisational Value through ESG'] },
        { title: 'Social responsibility & human rights', image: 'starter-esg-social', intro: 'Build a workplace where people are safe, respected and proud to represent you.',
          courses: ['Understanding and Implementing Human Rights in Malaysia', 'Behavioural Based Safety for Employees', 'Empower Yourself as Your Company Brand Ambassador', 'Enhancing Communication & Conflict Management'] },
        { title: 'Governance & ethics', image: 'starter-esg-governance', intro: 'Clear rules, fair processes and the confidence to apply them, for HR, managers and leaders.',
          courses: ['Employment Act', 'Handling Misconduct and Domestic Inquiry', 'Develop and Implement KRAs & KPIs', 'Anti-bribery and Anti-corruption'] },
        { title: 'Team dynamics & engagement', image: 'starter-esg-team', intro: 'Bring people together around a shared purpose, and help HR make learning spread.',
          courses: ['Uniting for Impact: Team Building', 'Make Learning Go Viral: Marketing Skills for HR & L&D', 'Training Facilitation for HR Personnel'] },
      ]),
      block('Calendar', { eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: 'Prefer a public class? Pick a date and book a seat.', only: 'all', count: 6, background: 'white' }),
      contact('Talk to us', 'Plan an ESG programme for your team.', CONTACT_TEXT),
    ]);
}

function skills(): PageData {
  return page('Professional training programmes | Next Academy',
    'Leadership, customer service, business efficiency, operations and safety training in Malaysia. Customised, in-house or public, HRD Corp claimable.', [
      block('Hero', {
        eyebrow: 'Training programmes · Professional skills', headline: 'Skills your team will use', highlight: 'on Monday morning.', headlineEnd: '',
        text: 'Practical professional development across industries: leadership, service, business efficiency, operations and safety. Customised for your business, run in-house or as public classes.',
        button1Label: 'Ask about a programme', button1Link: '#contact', button2Label: 'See the training calendar', button2Link: '/training-calendar',
        image: 'starter-trainer-stage', imageStyle: 'frame', background: 'dark',
      }),
      ...categorySections([
        { title: 'Business efficiency & innovation', image: 'starter-skills-business', intro: 'Work smarter with critical thinking, data and AI tools made for real Malaysian businesses.',
          courses: ['Critical Thinking & Problem-Solving for Global Leaders', 'AI for Business Efficiency', 'Smart Retail: AI-Driven Innovation for Malaysian Fashion Brands', 'Data Visualisation and Storytelling with Excel'] },
        { title: 'Customer service & hospitality excellence', image: 'starter-skills-service', intro: 'Turn every guest and customer moment into a reason to come back.',
          courses: ['Mastering Customer Service Excellence in Air & Sea Freight Logistics', 'Elevating the VIP Experience: Mastering Service Excellence', 'Mastering the Art of Handling Challenging Guests in Hospitality', 'Intensive Housekeeping Training for Room Attendants'] },
        { title: 'Leadership & professional development', image: 'starter-skills-leadership', intro: 'Grow leaders who communicate clearly, manage their time well and find the win-win.',
          courses: ['Leadership DNA', 'Running Out of Time', 'Speak Like a Pro', 'Mastering the Art of Negotiation: Unlocking Win-Win Deals'] },
        { title: 'Operations & safety training', image: 'starter-skills-safety', intro: 'Keep people safe and operations running, with training that meets the standards your industry expects.',
          courses: ['Essential Fire Fighting and First Aid', 'Occupational Safety & Health at the Workplace', 'Emergency Response Planning (ERP)', 'Forklift and Reach Truck Safety'] },
      ]),
      block('Calendar', { eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: 'Prefer a public class? Pick a date and book a seat.', only: 'all', count: 6, background: 'white' }),
      contact('Talk to us', 'Plan a programme for your team.', CONTACT_TEXT),
    ]);
}

function contactPage(): PageData {
  return page('Contact us | Next Academy',
    'Talk to Next Academy about training for your team. We recommend the programme and trainer, and help with the HRD Corp claim.', [
      block('Hero', {
        eyebrow: 'Contact us', headline: "Let's plan your team's", highlight: 'next training.', headlineEnd: '',
        text: "Tell us who you'd like to train and what you want to change. We'll recommend a programme, a trainer and a date, and help you with the HRD Corp claim.",
        button1Label: 'Send us a message', button1Link: '#contact', button2Label: 'See the training calendar', button2Link: '/training-calendar',
        image: 'starter-office', imageStyle: 'torn', background: 'light',
      }),
      block('Points', {
        eyebrow: 'How it works', heading: 'From first message to', highlight: 'trained team.', background: 'white',
        items: [
          { title: 'Tell us what you need', text: 'Send the form below or WhatsApp us. Tell us about your team, your goals and your timing.' },
          { title: 'We shape the programme', text: 'We pick the right trainer and tailor the content, then send you a proposal and quotation.' },
          { title: 'Train, then claim', text: 'We run the training and handle the HRD Corp paperwork with you, so claiming is simple.' },
        ],
      }),
      contact('Talk to us', 'Send us a message.', 'We usually reply within one working day.'),
    ]);
}

function privacy(): PageData {
  return page('Privacy notice | Next Academy', 'How Next Academy collects, uses and protects your personal data under the Personal Data Protection Act 2010.', [
    section('white', [
      heading('PDPA', 'Privacy notice', '', 'big'),
      text([
        '<p>This notice explains how Next Academy Sdn. Bhd. ("we") collects and uses your personal data, in line with Malaysia\'s Personal Data Protection Act 2010 (PDPA).</p>',
        '<h3>What we collect</h3><p>When you send a form, register for a programme or contact us, we collect the details you give us: your name, company, mobile number, email address, the programme you are interested in and anything you write in your message. When you attend a training, we also keep attendance records and the documents needed for HRD Corp grants and claims.</p>',
        '<h3>Why we use it</h3>' + list(['To reply to your enquiry and send you proposals and quotations', 'To register you for programmes and run the training', 'To prepare HRD Corp grant applications and claims', 'To issue invoices and certificates', 'To tell you about upcoming programmes, if you agree (you can opt out any time)']),
        '<h3>Who we share it with</h3><p>Only those who need it to deliver your training: the trainer and venue for your programme, HRD Corp for grants and claims, and the service providers who run our systems. We never sell your personal data.</p>',
        '<h3>Website visits</h3><p>Our website counts visits without cookies and without keeping anything that identifies you. We only record which pages were opened, where the visit came from and whether it was a phone or a computer.</p>',
        '<h3>How we keep it safe</h3><p>Your data is kept in secure systems that only authorised staff can open, and only as long as needed for the purposes above and for legal and HRD Corp record-keeping.</p>',
        '<h3>Your rights</h3><p>You may ask to see or correct your personal data, or to stop receiving marketing messages, at any time. Contact us using the details at the bottom of this page.</p>',
        '<p>If you do not give us the data we need, we may not be able to register you or process an HRD Corp claim.</p>',
        '<p><em>Last updated: October 2026.</em></p>',
      ].join('')),
    ], 'narrow'),
  ]);
}

/** The designed pages, in menu order. Slugs keep the old WordPress addresses where there was one. */
export function starterPages(): { title: string; slug: string; data: PageData }[] {
  n = 0;
  return [
    { title: 'Home', slug: '', data: home() },
    { title: 'About us', slug: 'about-us', data: about() },
    { title: 'Training programmes (ESG)', slug: 'training-courses-esg', data: esg() },
    { title: 'Training programmes (Professional skills)', slug: 'training-courses', data: skills() },
    { title: 'Contact us', slug: 'contact-us', data: contactPage() },
    { title: 'Privacy notice', slug: 'privacynotice', data: privacy() },
  ];
}

/** The menu for the designed pages; `slug` is swapped for that page's id when loading. */
export const STARTER_MENU: (MenuItem & { slug?: string })[] = [
  { label: 'About us', slug: 'about-us' },
  { label: 'Training calendar', url: '/training-calendar' },
  { label: 'ESG programmes', slug: 'training-courses-esg' },
  { label: 'Professional programmes', slug: 'training-courses' },
  { label: 'Trainers', url: '/trainers' },
  { label: 'Contact us', slug: 'contact-us', button: true },
];
