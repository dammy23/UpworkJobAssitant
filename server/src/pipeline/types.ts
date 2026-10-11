/** A job in the shape the pipeline works with, whatever source it came from. */
export interface NormalizedJob {
  upworkId: string;
  title: string;
  description: string;
  url: string;
  category: string | null;
  skills: string[];
  jobType: 'fixed' | 'hourly';
  budgetMin: number | null; // USD: fixed price, or hourly minimum
  budgetMax: number | null; // USD: hourly maximum
  experienceLevel: 'entry' | 'intermediate' | 'expert' | null;
  clientCountry: string | null;
  clientPaymentVerified: boolean | null;
  clientHireRate: number | null; // percent
  clientTotalSpend: number | null; // USD
  proposalsCount: number | null;
  postedAt: Date | null;
  /** The client's screening questions, answered in the proposal. */
  questions: string[];
  connectsRequired: number | null;
  raw: unknown;
}

/** What a job source is asked for on each run. */
export interface JobSearch {
  /** Free-text terms built from the applier's role titles and keywords. */
  terms: string[];
  category: string | null;
  limit: number;
}

export interface JobSource {
  readonly name: string;
  search(query: JobSearch): Promise<NormalizedJob[]>;
}
