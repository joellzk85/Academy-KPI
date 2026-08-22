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
}

export interface QuotationItem {
  id: string;
  no: number;
  program: string;
  code: string;
  date: string;
  trainer: string;
  feePerDay: number;
  days: number;
  totalFee: number;
}

export interface Quotation {
  id: string;
  refNumber: string;
  date: string;
  attn: string;
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
  specialization: string;
  contact?: string;
  email?: string;
  rate: number;
  status: 'Available' | 'Booked' | 'On Leave';
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
}


