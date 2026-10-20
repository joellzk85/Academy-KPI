import type { DocKind, EmergencyContact, Gender, TrainerFile, TrainingType } from './lib/trainerProfile';

export interface Student {
  id: string;
  name: string;
  email: string;
  cohortId: string;
  attendanceRate: number; // e.g. 95 (out of 100)
  assignmentsCompleted: number; // e.g. 14
  assignmentsTotal: number; // e.g. 15
  currentGrade: number; // e.g. 88 (out of 100)
  riskScore: 'Low' | 'Medium' | 'High';
  status: 'Active' | 'Graduated' | 'Withdrawn';
  employmentStatus: 'Not Placed' | 'Interviewing' | 'Placed';
  placedCompany?: string;
  role?: string;
  notes: string;
  weeklyGrades: number[];
}

export interface Cohort {
  id: string;
  name: string;
  courseType: 'Web Development' | 'Digital Marketing' | 'iOS Development' | 'Data Science';
  weekCurrent: number;
  weekTotal: number;
  startDate: string;
  studentsCount: number;
  averageGrade: number;
  attendanceAverage: number;
  status: 'active' | 'upcoming' | 'completed';
  mentors: string[];
}

export interface ScheduleItem {
  id: string;
  title: string;
  time: string;
  cohortName: string;
  type: 'Lecture' | 'Lab Session' | 'Guest Speaker' | 'Career Workshop' | 'Review Session';
  instructor: string;
  status: 'upcoming' | 'live' | 'completed';
}

export interface FeedbackItem {
  id: string;
  date: string;
  rating: number; // 1 to 10
  sentiment: 'Excellent' | 'Good' | 'Neutral' | 'Poor';
  comment: string;
  cohortName: string;
}

export interface JobFunnelStep {
  stage: string;
  count: number;
  percentage: number;
}

export interface PartnerCompany {
  name: string;
  industry: string;
  hiresCount: number;
  logoColor: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface Representative {
  id: string;
  name: string;
  email?: string;
  role?: 'rep' | 'admin' | 'management';
  kpiTemplate?: string;   // KPI template chosen by Management (see src/lib/kpi.ts)
  noKpis?: boolean;       // Management without a KPI set: has a workspace, but no KPI page and no KPI counting
  kpi: {
    salesFigure: number[];
    proposals: number[];
    preview: number[];
    extraMetric?: number[];
    lastWeekProgress?: string;
    helpNeeded?: string;
    dateline?: string;
    accountabilityPartnerId?: string;
    taggedRepIds?: string[];
    tagNote?: string;
    lastWeekProgressList?: string[];
    helpNeededList?: string[];
    datelineList?: string[];
    accountabilityPartnerIdList?: string[];
    taggedRepIdsList?: string[][];
    tagNoteList?: string[];
    completedTagsList?: string[][];
    completedAccountabilityList?: boolean[];
  };
  targets: {
    salesFigure: number;
    proposals: number;
    preview: number;
    extraMetric?: number;
  };
}

export interface GoogleLinks {
  quotation: string;
  clientList: string;
  faci: string;
  venue: string;
  trainerList: string;
  pendingTasks: string;
  pAndL: string;
}

export interface CalendarEvent {
  id: string;
  time: string;
  title: string;
  date: string; // YYYY-MM-DD
  color?: string;
  attendees?: string[]; // IDs of representatives tagged/invited
  syncWithGoogle?: boolean;
  gmailCalendarSync?: string;
  source?: 'google';       // shown from the shared Google Calendar (read-only in the CRM)
  link?: string;           // opens it in Google Calendar
}

export interface QuotationItem {
  id: string;
  no: number;
  program: string;
  code: string;
  date: string;
  trainer: string;
  trainerId?: string;      // from the trainer list (live name while the quotation is a draft)
  programmeId?: string;    // from the programme list (live name and HRDC code while a draft)
  useDealDate?: boolean;   // show the linked deal's training date
  kind?: 'programme' | 'item';  // 'item' = other items (bus, T-shirts): description, quantity and price only
  feePerDay: number;       // rate per day, or price each for an item
  days: number;            // days, or quantity for an item
  totalFee: number;
}

export interface Quotation {
  id: string;
  refNumber: string;
  refAuto?: boolean;       // numbered by the CRM (lib/docRefs.ts): the client's code is put in while it's a draft
  date: string;
  attn: string;
  attnOverride?: string;   // a different PIC for this quotation only (else the client's contact person)
  addressTo?: 'company' | 'employer'; // print the client's company name (default) or its employer name
  company: string;
  address: string;
  venue: string;
  time: string;
  participants: string;
  trainingProvider: string;
  items: QuotationItem[];
  remarks: string[];
  terms: string[];
  applySST?: boolean;      // older quotations: add SST on top of the fees
  sstIncluded?: boolean;   // "Price includes SST" ticked (else SST is not included); see lib/quoteSst.ts
  sstRate?: number;
  taggedBy?: string;
  tagNote?: string;
  isHidden?: boolean;
  preparedBy?: string;
  creatorId?: string;
  ownerId?: string;
  ownerName?: string;
  taggedRepId?: string;
  taggedRepName?: string;
  isCompleted?: boolean;
  clientId?: string;
  venueId?: string;
  pipelineId?: string;
  sharedWithIds?: string[];   // teammates who can open and edit this same quotation
  sharedLog?: Record<string, { at: string; byId: string; byName: string }>;   // who shared it with each of them, and when (alerts)
  // Draft = reads client, deal, programme, trainer and venue live. Sent = the text fields hold the locked copy that was sent.
  status?: 'draft' | 'sent';
  sentAt?: string;
  sentById?: string;
  sentByName?: string;
  sendLog?: QuoteSendEntry[];  // each time it was emailed, WhatsApped or marked sent (2026-10-18)
}

// One "sent" record on a quotation: how, by whom, when and to whom.
export interface QuoteSendEntry {
  at: string;
  byId: string;
  byName: string;
  channel: 'email' | 'whatsapp' | 'manual' | 'link';   // link: a private client link (2026-10-19)
  to?: string;
  cc?: string;
}

export interface CourseOutlineItem {
  id: string;
  no: number;
  moduleTitle: string;
  topics: string;
  duration: string;
  methodology: string;
  day?: number;                 // which training day it's on (multi-day outlines; 2026-10-19)
}

export interface OutlineAgendaRow {
  id: string;
  time: string;                 // e.g. 9:00 AM – 9:35 AM
  text: string;                 // e.g. Module 1: Ice breaker ("Module N" prints in bold)
  isDay?: boolean;              // a day heading row ("Day 1") instead of a time slot
}

export interface CourseOutline {
  id: string;
  refNumber: string;
  refAuto?: boolean;       // numbered by the CRM (lib/docRefs.ts): the client's code is put in while it's a draft
  date: string;
  courseTitle: string;
  durationDays: number;
  totalHours: number;
  category: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  audience: string;
  prerequisites: string;
  overview: string;
  outcomes: string[];
  items: CourseOutlineItem[];
  preparedBy?: string;
  creatorId?: string;
  ownerId?: string;
  ownerName?: string;
  taggedRepId?: string;
  taggedRepName?: string;
  taggedBy?: string;
  tagNote?: string;
  isHidden?: boolean;
  isCompleted?: boolean;
  preparedForCompany?: string;
  clientId?: string;
  pipelineId?: string;
  // Redesign (2026-10-17): read live from the deal while a draft, locked copy once sent.
  useProgrammeName?: boolean;   // course title = the programme's name (else courseTitle as typed)
  programmeId?: string;         // the programme this outline is for (optional; else the linked deal's programme)
  trainerId?: string;           // the trainer who wrote / will deliver it (trainers_directory)
  status?: 'draft' | 'sent';
  sentAt?: string;
  sentById?: string;
  sentByName?: string;
  sharedWithIds?: string[];     // teammates who can open and edit this same outline
  sharedLog?: Record<string, { at: string; byId: string; byName: string }>;   // who shared it with each of them, and when (alerts)
  sendLog?: QuoteSendEntry[];  // each time it was emailed, WhatsApped or marked sent (2026-10-19)
  // New look and details (Joel, 2026-10-19, following his "Discover Your Office Persona" outline). All optional.
  kind?: 'training';            // outline type; team building will be a second type later
  methods?: string[];           // learning methods
  dayTitles?: string[];         // "Day 1: <title>" headings on the modules page
  agenda?: OutlineAgendaRow[];  // course agenda page (only printed when it has rows)
  terms?: string;               // terms and conditions (undefined = the standard terms)
  hideTerms?: boolean;          // leave out the Administrative details page
  difficulty?: string;          // optional extras, printed only when filled in
  evaluation?: string[];
  bloomLevel?: number;          // 1-6
  nextTraining?: string[];
  designedBy?: string;
}

export interface Client {
  id: string;
  companyName: string;
  code?: string;         // customer code, e.g. HKL (2026-10-19): starts quotation and proposal numbers (lib/docRefs.ts)
  employerName?: string; // optional, e.g. the employer registered with HRD Corp; shown in Project P&L; a quotation can be addressed to it
  contactName: string;
  designation?: string;
  phone?: string;
  email?: string;
  address?: string;
  industry?: string;
  hrdcRegistered?: boolean;
  notes?: string;
  createdAt?: number;
  createdBy?: string;
  createdByName?: string;
}

export interface Trainer {
  id: string;
  name: string;
  specialization: string;       // old free-text topics, kept as a note (programmeIds replaced it, 2026-10-17)
  programmeIds?: string[];      // programmes from the Programme list this trainer can teach
  // Filled in by the trainer from a profile link, or by the team (2026-10-17)
  bio?: string;
  experienceYears?: number;
  qualifications?: string;
  pastClients?: string;
  suggestedTopics?: string;     // topics they teach that aren't in the Programme list yet (one per line)
  photoUrl?: string;            // photo, shown on teambuilding proposals (2026-10-19)
  // More details (2026-10-20, lib/trainerProfile.ts): all optional.
  gender?: Gender;
  address?: string;
  emergencyContact?: EmergencyContact;
  languages?: string[];
  languagesOther?: string;
  trainingTypes?: TrainingType[];
  otherCerts?: string;
  linkedin?: string;
  youtube?: string;
  otherSocial?: string;
  docs?: Partial<Record<DocKind, TrainerFile>>;   // Accredited TTT form, biodata, trainer profile (latest of each)
  contact?: string;
  email?: string;
  rate: number;
  status: 'Available' | 'Booked' | 'On Leave';
  notes?: string;
  createdAt?: number;
  createdBy?: string;
  createdByName?: string;
}

export interface Venue {
  id: string;
  name: string;
  distance?: string;
  meetingPackagePrice?: string;
  roomPackagePrice?: string;
  dinnerPackage?: string;
  facilities?: string;
  contact?: string;
  remarks?: string;
  pictures?: string;            // older: a typed link or note
  photos?: string[];            // uploaded photos (2026-10-19); the first is the main one
  status: 'Available' | 'Booked' | 'Under Renovation';
  createdAt?: number;
  createdBy?: string;
  createdByName?: string;
}

export interface Appointment {
  id: string;
  clientName: string;
  clientId?: string;
  pipelineId?: string;
  repId: string;
  repName: string;
  date: string;
  time?: string;
  type: 'Discovery Call' | 'Site Visit' | 'Proposal Meeting' | 'Follow-up' | 'Other';
  status: 'Scheduled' | 'Completed' | 'No-Show' | 'Cancelled';
  notes?: string;
  createdAt?: number;
  createdBy?: string;
  createdByName?: string;
}

export interface ClientPayment {
  id: string;
  clientName: string;
  clientId?: string;
  quotationId?: string;
  quotationRef?: string;
  pipelineId?: string;
  invoiceAmount: number;
  amountReceived: number;
  paymentDate?: string;
  dueDate?: string;
  status: 'Unpaid' | 'Partial' | 'Paid' | 'Overdue';
  notes?: string;
  createdAt?: number;
  createdBy?: string;
  createdByName?: string;
}

export interface AdminRecord {
  id: string;
  completed: boolean;
  no: string;
  trainingDate: string;
  programmeName: string;
  client: string;
  trainer: string;
  typeOfTraining: string;
  trainingHour: number;
  quotation: string;
  putInBitrixCalendar: string;
  venuePicContact: string;
  bookHotel: string;
  payHotel: string;
  bookBus: string;
  payBus: string;
  bookFacilitator: string;
  payFacilitator: string;
  trainerPo: string;
  grantApproved: string;
  outputSummaryQr: string;
  handoutsMaterials: string;
  uploadPhotosDrive: string;
  attendanceList: string;
  invoice: string;
  jd14: string;
  certificate: string;
  trainingReport: string;
  ownerId?: string;
  ownerName?: string;
  createdAt?: number;
  clientId?: string;
  pipelineId?: string;
  quotationId?: string;
}

// ---- Team & login (Phase 1) ----
// The Team list is the ONE place people's names and roles live.
// Every other screen reads names from here.
export type TeamRole = 'rep' | 'admin' | 'management';

export interface TeamMember {
  id: string;               // also this person's login ID (never shown)
  name: string;
  role: TeamRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt?: number;
  createdById?: string;
  removedAt?: number | null;
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  rep: 'Sales rep',
  admin: 'Admin',
  management: 'Management',
};
