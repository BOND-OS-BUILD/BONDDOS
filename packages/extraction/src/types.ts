export interface TextMatch {
  value: string;
  offset: number;
}

export interface ExtractionResult {
  emails: TextMatch[];
  phones: TextMatch[];
  urls: TextMatch[];
  dates: TextMatch[];
  fileReferences: TextMatch[];
  personNames: TextMatch[];
  companyNames: TextMatch[];
  projectMentions: TextMatch[];
  meetingMentions: TextMatch[];
}
