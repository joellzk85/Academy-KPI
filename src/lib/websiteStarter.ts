// The designed website (Joel, 2026-10-30; docs/features/website.md): the pages, copy, photos and menu loaded by
// Website → Pages → "Load the designed pages". Copy rewritten from the old WordPress site; photos are Next Academy's
// own (from the old site) or AI-made in Canva. Files sit in public/site-assets/starter/ and are copied into
// Website → Media on loading, so they can be replaced like any other photo. Company details are never typed here:
// the Contact block and the footer print them from lib/company.ts.
import type { MenuItem, PageData } from './website';
import { COMPANY } from './company';

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

// Client testimonials already on Next Academy's YouTube channel: copied into Media to pick from; no page uses them
// until the owner fills a video slot (2026-10-31).
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
const columns = (split: number, col1: any[], col2: any[], col3: any[] = []) => block('Columns', { count: col3.length ? '3' : '2', split, col1, col2, col3 });
const section = (background: string, content: any[], width = 'normal', edge = 'straight') => block('Section', { background, spacing: 'l', width, texture: background === 'white' ? 'no' : 'yes', edge, content });
const page = (pageTitle: string, description: string, content: any[]): PageData => ({ root: { props: { pageTitle, description } }, content });
const list = (items: string[]) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

const contact = (eyebrow: string, heading: string, text: string, background = 'black', edge = 'torn') => block('Contact', { eyebrow, heading, text, background, edge });
const reviewOnHero = (r: { name: string; role: string; text: string; source: string }) => ({ reviewName: r.name, reviewRole: r.role, reviewText: r.text, reviewSource: r.source });
const CONTACT_TEXT = "Tell us about your team and what you'd like to change. We'll come back with a programme that fits, and show you how to claim it through HRD Corp.";

type Category = { title: string; intro: string; courses: string[]; image: string };

function categorySections(cats: Category[]) {
  return cats.map((c, i) => {
    const words = [
      heading(String(i + 1).padStart(2, '0'), c.title),
      text(`<p>${c.intro}</p>${list(c.courses)}`),
      button('Ask about these programmes', '#contact', i % 2 ? 'dark' : 'blue'),
    ];
    const pic = [photo(c.image, i % 2 ? 'torn' : 'tinted', 'medium')];
    // Photo left, then right: easier on the eye down a long page. Phones show both one under the other.
    return section(i % 2 ? 'light' : 'white', [i % 2 ? columns(55, words, pic) : columns(45, pic, words)], 'normal', 'torn');
  });
}


// Real Google reviews, as Next Academy already shows them on its Facebook posts.
const REVIEWS = [
  { name: 'Suzanna Yip', role: 'Participant', text: 'Good training and good venue with good food.', source: 'Google review' },
  { name: 'Rakumaran Pannirselvam', role: 'Participant', text: 'The activities was fun and very engaging. Had good understanding of the training content.', source: 'Google review' },
];

// Home tells the StoryBrand story (Joel, 2026-10-31): the client is the hero and Next Academy the guide. Their goal
// (hero), the problem, two doorways (HR / business owners), the guide (tagline, vision, numbers, reviews, logos), the
// plan, programmes and dates, success vs failure, then the call to action. Same look as the Facebook posts. Video
// slots start empty: the owner picks each video in the editor, and empty ones never show on the website.
const BOOK = 'Book a free consult';
const videoSlots = (count: number) => Array.from({ length: count }, () => ({ video: '', caption: '' }));
const videos = (eyebrow: string, heading: string, highlight: string, count: number, background = 'white', edge = 'torn') =>
  block('VideoRow', { eyebrow, heading, highlight, text: '', videos: videoSlots(count), buttonLabel: '', buttonLink: '#contact', background, edge });
const compare = (rows: [string, string][]) => block('Compare', {
  eyebrow: 'Six months from now', heading: "Imagine a team that's inspired to come to work", highlight: 'every day.', text: '',
  withoutTitle: 'Without a plan', withTitle: 'With Next Academy', rows: rows.map(([without, w]) => ({ without, with: w })),
  buttonLabel: BOOK, buttonLink: '#contact', background: 'white', edge: 'torn',
});
const plan = (items: { title: string; text: string }[]) => block('Points', { eyebrow: 'How it works', heading: 'Three steps.', highlight: 'No guesswork.', look: 'numbers', background: 'white', edge: 'torn', items });
const problem = (heading: string, highlight: string, items: { title: string; text: string }[]) => block('Points', { eyebrow: 'Sound familiar?', heading, highlight, look: 'squares', background: 'dark', edge: 'torn', items });
const BOOK_TEXT = "One short chat about your team and what you'd like to change. No slides, no obligation.";

function home(): PageData {
  return page('Next Academy | HRD Corp claimable training in Malaysia',
    'Practical, HRD Corp claimable training for Malaysian companies. Programmes shaped around your people, in-house or public.', [
      block('Hero', {
        eyebrow: 'HRD Corp registered training provider',
        headline: 'Training your team will actually', highlight: 'use.', headlineEnd: '',
        text: 'Practical, HRD Corp claimable training for Malaysian companies. Better people, and your levy put to real use.',
        button1Label: BOOK, button1Link: '#contact', button2Label: 'See training dates', button2Link: '/training-calendar',
        image: 'starter-trainer-stage', imageStyle: 'tinted', ...reviewOnHero(REVIEWS[1]), showRating: 'yes', background: 'dark',
      }),
      problem('Most training is forgotten by', 'Monday.', [
        { title: 'Slides, not skills', text: 'A full day in a hotel room, and nothing changes back at work.' },
        { title: 'Levy sitting idle', text: "Your HRD Corp levy is your company's money, yet it often goes unused." },
        { title: 'Training picked on price, not on need', text: 'A generic course that fits nobody, and the same problems a month later.' },
      ]),
      videos('In their words', 'Hear it from', 'a client.', 1, 'dark', 'straight'),
      block('Tiles', {
        eyebrow: 'Find your path', heading: 'Which one', highlight: 'sounds like you?', background: 'light', edge: 'torn',
        items: [
          { image: 'starter-workshop-group', eyebrow: "I'm in HR / L&D", title: 'I need training sorted without the headache.', tags: '', linkLabel: 'See how we help HR', link: '/for-hr' },
          { image: 'starter-skills-business', eyebrow: 'I run the business', title: 'I need my people to perform, and my levy to pay off.', tags: '', linkLabel: 'See how we help owners', link: '/for-business-owners' },
        ],
      }),
      section('white', [
        heading('Why Next Academy', "Behind every great employee is a trainer who didn't use", '100 slides.'),
        text("<p>We've sat on your side of the table. We know training is judged by what changes at work, not by whether it happened. So every programme is shaped around your people, and we stay with you from the first chat to the final report.</p><p><strong>Our vision: to create a world where people are inspired to go to work every day.</strong></p>"),
        block('ProofBlock', { items: [] }),
      ], 'normal', 'torn'),
      block('ReviewWall', {
        eyebrow: 'What participants say', heading: 'Real rooms.', highlight: 'Real reviews.', background: 'light',
        photos: [{ image: 'starter-workshop-group' }, { image: 'starter-team-work' }, { image: 'starter-trainer-stage' }, { image: 'starter-hero' }],
        reviews: REVIEWS,
      }),
      block('LogoStrip', { label: 'Trusted by teams at', items: [] }),
      plan([
        { title: 'Tell us your goal', text: 'A free 30-minute chat about your team and what needs to change.' },
        { title: 'We shape the programme', text: 'Built around your people, your industry and your goals.' },
        { title: 'We train and report back', text: 'Engaging training days, and a clear report on how your team did.' },
      ]),
      block('Tiles', {
        eyebrow: 'Programmes', heading: 'Two tracks. One goal:', highlight: 'people who perform.', background: 'light', edge: 'torn',
        items: [
          { image: 'starter-esg-environment', eyebrow: 'Track 01', title: 'ESG programmes', tags: 'Environment, Social & human rights, Governance & ethics, Team engagement', linkLabel: 'See ESG programmes', link: '/training-courses-esg' },
          { image: 'starter-skills-leadership', eyebrow: 'Track 02', title: 'Professional skills', tags: 'Leadership, Customer service, Business & AI, Operations & safety', linkLabel: 'See professional skills', link: '/training-courses' },
        ],
      }),
      block('Calendar', { eyebrow: 'Training calendar', heading: 'Public classes, open for seats.', text: 'Join a public class with people from other companies. Most programmes are HRD Corp claimable.', only: 'all', count: 4, background: 'white', edge: 'torn' }),
      compare([
        ['Same problems, new excuses', 'A team that works better together, and shows it'],
        ['Levy left on the table', 'Levy turned into real skills'],
        ['People leave to grow elsewhere', 'People grow with you, and stay'],
        ['Training seen as a cost', 'Training seen as a result'],
      ]),
      videos('Client stories', 'Hear it from', 'our clients.', 1, 'black', 'torn'),
      contact(BOOK, "Let's plan your team's next win.", BOOK_TEXT, 'black', 'straight'),
    ]);
}

// The two doorways from the homepage (Joel, 2026-10-31): the same story told to HR / L&D and to business owners.
function forHr(): PageData {
  return page('Training for HR and L&D teams | Next Academy',
    'For HR and L&D: training that fits your people, delivered and reported back so management can see it worked. HRD Corp claimable.', [
      block('Hero', {
        eyebrow: 'For HR and L&D', headline: 'Training your people need. Results your management can', highlight: 'see.', headlineEnd: '',
        text: 'You plan the training and still get asked "did it work?". We make sure the answer is yes.',
        button1Label: BOOK, button1Link: '#contact', button2Label: 'See training dates', button2Link: '/training-calendar',
        image: 'starter-workshop-group', imageStyle: 'tinted', showRating: 'yes', background: 'dark',
      }),
      problem('The training happened. Did anything', 'change?', [
        { title: 'Finding training that fits', text: 'Plenty of courses out there. Few are built for your people and your industry.' },
        { title: 'Sit through it, forget it', text: 'Staff enjoy the day, then go back to doing things the old way.' },
        { title: 'Proving it was worth it', text: 'Management wants to know what the company got for it.' },
      ]),
      plan([
        { title: 'Tell us what your team needs', text: 'A free chat about your people, your goals and your timing.' },
        { title: 'We shape it around them', text: 'Your industry, your people, your goals. No generic slides.' },
        { title: 'We deliver and report back', text: 'Engaging training days, and a report you can forward to management as it is.' },
      ]),
      videos('From HR teams like yours', 'Hear it from', 'HR.', 2, 'light', 'torn'),
      compare([
        ['Training picked in a rush', 'Training that fits the need'],
        ['Staff forget it by Monday', 'Skills they use at work'],
        ['"Did it work?" with no answer', 'A clear report for management'],
        ['Levy left on the table', 'Levy put to real use'],
      ]),
      contact(BOOK, "Let's plan your team's next win.", BOOK_TEXT, 'black', 'torn'),
    ]);
}

function forOwners(): PageData {
  return page('Training for business owners | Next Academy',
    'For business owners and directors: turn your HRD Corp levy into a team that performs. Training agreed on outcomes, built around your business.', [
      block('Hero', {
        eyebrow: 'For business owners and directors', headline: 'Your levy, turned into', highlight: 'results.', headlineEnd: '',
        text: 'You already pay the HRD Corp levy. The question is whether it comes back as a better team.',
        button1Label: BOOK, button1Link: '#contact', button2Label: 'See training dates', button2Link: '/training-calendar',
        image: 'starter-skills-business', imageStyle: 'tinted', showRating: 'yes', background: 'dark',
      }),
      problem('Training was paid for. Nothing', 'changed.', [
        { title: 'Paying for training that changes nothing', text: 'The course ends, the bill is paid, and work goes on as before.' },
        { title: 'Good people leaving', text: 'They stop growing, so they grow somewhere else.' },
        { title: 'No clear answer', text: 'When you ask "what did we get for it?", nobody can say.' },
      ]),
      plan([
        { title: 'Agree the outcome first', text: 'What should your people do differently after the training?' },
        { title: 'Build around your business', text: 'Your industry, your people. No generic slides.' },
        { title: 'Report back', text: 'What was covered, how the team did, and what to do next.' },
      ]),
      videos('From owners like you', 'Hear it from', 'business owners.', 2, 'light', 'torn'),
      compare([
        ['Same problems, new excuses', 'A team that works better together, and shows it'],
        ['Levy left on the table', 'Levy turned into real skills'],
        ['People leave to grow elsewhere', 'People grow with you, and stay'],
        ['Training seen as a cost', 'Training seen as a result'],
      ]),
      contact(BOOK, "Let's plan your team's next win.", BOOK_TEXT, 'black', 'torn'),
    ]);
}

function about(): PageData {
  return page('About us | Next Academy',
    'Next Academy is a Malaysian training provider registered with HRD Corp. Our vision, mission and HEART values, and how we work.', [
      block('Hero', {
        eyebrow: 'About Next Academy', headline: 'We help people go to work', highlight: 'inspired.', headlineEnd: '',
        text: 'Next Academy is a Malaysian training provider registered with HRD Corp. Through personalised training and coaching, we help people and organisations lead with integrity, grow sustainably and take real action.',
        button1Label: 'See our programmes', button1Link: '/training-courses', button2Label: 'Talk to us', button2Link: '#contact',
        image: 'starter-trainer-stage', imageStyle: 'tinted', background: 'dark',
      }),
      section('white', [columns(50,
        [heading('Our vision', 'A world where people are inspired to go to work every day.')],
        [heading('Our mission', 'Helping organisations achieve unity by being purpose-driven and taking real action.')])], 'normal', 'torn'),
      section('light', [columns(45,
        [photo('starter-team-work', 'tinted', 'tall')],
        [
          heading('What we believe', 'Doing good should be the', 'golden standard.'),
          text('<p>We put ESG values (environmental, social and governance) at the heart of every decision, action and ambition. Not as a report to file, but as the way a good business runs.</p><p>So every programme we design starts with one question: what will your people do differently at work next week, and who benefits?</p>'),
        ])], 'normal', 'torn'),
      block('Points', {
        eyebrow: 'Our HEART values', heading: 'Five values that shape', highlight: 'how we work.', look: 'squares', background: 'dark', edge: 'torn',
        items: [
          { title: 'Humility', text: "We listen first. Every team knows things we don't, and the best training starts from there." },
          { title: 'Expertise', text: 'Our trainers are HRD Corp accredited and bring real industry experience into the room.' },
          { title: 'Accountability', text: "We own the outcome, not just the training day. If it doesn't work at work, it doesn't count." },
          { title: 'Remarkable', text: 'We aim for training people talk about afterwards, for the right reasons.' },
          { title: 'Trustworthiness', text: 'We do what we say, protect what you share with us and keep our promises.' },
        ],
      }),
      section('white', [columns(50,
        [
          heading('Unlocking Talents', 'The right trainer for the', 'right training.'),
          text("<p>We match each programme with a trainer who has done the job, not just studied it. Then we tailor the content to your industry, your people and your goals, and make the HRD Corp claim simple.</p>"),
          button('Meet our trainers', '/trainers', 'dark'),
        ],
        [photo('starter-workshop-group', 'torn', 'medium')])], 'normal', 'torn'),
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
        image: 'starter-workshop-group', imageStyle: 'tinted', background: 'dark',
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
      block('Calendar', { eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: 'Prefer a public class? Pick a date and book a seat.', only: 'all', count: 6, background: 'white', edge: 'torn' }),
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
        image: 'starter-trainer-stage', imageStyle: 'tinted', background: 'dark',
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
      block('Calendar', { eyebrow: 'Training calendar', heading: 'Upcoming public programmes', text: 'Prefer a public class? Pick a date and book a seat.', only: 'all', count: 6, background: 'white', edge: 'torn' }),
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
        image: 'starter-office', imageStyle: 'tinted', background: 'dark',
      }),
      block('Points', {
        eyebrow: 'How it works', heading: 'From first message to', highlight: 'trained team.', look: 'numbers', background: 'white', edge: 'torn',
        items: [
          { title: 'Tell us what you need', text: 'Send the form below or WhatsApp us. Tell us about your team, your goals and your timing.' },
          { title: 'We shape the programme', text: 'We pick the right trainer and tailor the content, then send you a proposal and quotation.' },
          { title: 'Train, then claim', text: 'We run the training and handle the HRD Corp paperwork with you, so claiming is simple.' },
        ],
      }),
      contact('Talk to us', 'Send us a message.', 'We usually reply within one working day.'),
    ]);
}

// Careers (Joel, 2026-10-30): the old /career and /internship-opportunity pages were empty, so this is new copy built
// on the HEART values. No openings are listed; people send their CV to the company email (lib/company.ts).
function careers(): PageData {
  const mail = (subject: string) => `mailto:${COMPANY.email}?subject=${encodeURIComponent(subject)}`;
  const cv = `<a href="${mail('Career at Next Academy')}">${COMPANY.email}</a>`;
  return page('Careers | Next Academy',
    'Work with Next Academy: careers and internships at a Malaysian HRD Corp training provider. Send us your CV.', [
      block('Hero', {
        eyebrow: 'Careers', headline: 'Help people go to work', highlight: 'inspired.', headlineEnd: '',
        text: "We're a growing Malaysian training provider. If you like people, learning and getting things done, we'd like to hear from you.",
        button1Label: 'Send us your CV', button1Link: mail('Career at Next Academy'), button2Label: 'About us', button2Link: '/about-us',
        image: 'starter-team-work', imageStyle: 'tinted', background: 'dark',
      }),
      block('Points', {
        eyebrow: 'Who we look for', heading: 'People who live our', highlight: 'HEART values.', look: 'squares', background: 'white', edge: 'torn',
        items: [
          { title: 'Humility', text: 'You listen first and learn from everyone in the room.' },
          { title: 'Expertise', text: 'You are good at what you do, and keep getting better.' },
          { title: 'Accountability', text: 'You own the result, not just the task.' },
          { title: 'Remarkable', text: 'You care about doing work people talk about for the right reasons.' },
          { title: 'Trustworthiness', text: 'You do what you say, and keep what is shared with you safe.' },
        ],
      }),
      block('Tiles', {
        eyebrow: 'Ways to join', heading: 'Find your', highlight: 'place with us.', background: 'light', edge: 'torn',
        items: [
          { image: 'starter-workshop-group', eyebrow: 'Careers', title: 'Join the team', tags: 'Sales, Training operations, Admin and accounts', linkLabel: 'Send us your CV', link: mail('Career at Next Academy') },
          { image: 'starter-trainer-stage', eyebrow: 'Internships', title: 'Internships', tags: 'Hands-on projects, Real training days, A mentor who cares', linkLabel: 'Apply for an internship', link: mail('Internship at Next Academy') },
        ],
      }),
      section('dark', [
        heading('How to apply', 'Send us your CV and a few lines', 'about you.'),
        text(`<p>Email ${cv} with the role or internship you're interested in, when you can start and what you'd like to learn with us. We read every message and reply to the ones that fit what we need now.</p>`),
      ], 'narrow', 'torn'),
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
    { title: 'For HR and L&D', slug: 'for-hr', data: forHr() },
    { title: 'For business owners', slug: 'for-business-owners', data: forOwners() },
    { title: 'About us', slug: 'about-us', data: about() },
    { title: 'Training programmes (ESG)', slug: 'training-courses-esg', data: esg() },
    { title: 'Training programmes (Professional skills)', slug: 'training-courses', data: skills() },
    { title: 'Contact us', slug: 'contact-us', data: contactPage() },
    { title: 'Careers', slug: 'career', data: careers() },
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
