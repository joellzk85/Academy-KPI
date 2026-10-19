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
  date: string;
  attn: string;
  attnOverride?: string;   // a different PIC for this quotation only (else the client's contact person)
  company: string;
  address: string;
  venue: string;
  time: string;
  participants: string;
  trainingProvider: string;
  items: QuotationItem[];
  remarks: string[];
  terms: string[];
  applySST?: boolean;
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
  channel: 'email' | 'whatsapp' | 'manual';
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
}

export interface CourseOutline {
  id: string;
  refNumber: string;
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
}

export interface Client {
  id: string;
  companyName: string;
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
  suggestedTopics?: string;     // topics they teach that aren't in the Programme list yet
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
  pictures?: string;
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
