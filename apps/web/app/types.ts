export interface IntakeFormData {
  projectName: string;
  concept: string;
  problem: string;
  targetAudience: string;
  blockchain: string;
  existingCode: string;
  competitors: string;
  teamInfo: string;
  timeline: string;
  budget: string;
  documentNeeds: string;
}

export interface ResearchReport {
  projectSummary: string;
  problemAnalysis: {
    coreProblem: string;
    severity: string;
    existingSolutions: string[];
    gap: string;
  };
  marketContext: {
    sector: string;
    tam: string;
    growthTrend: string;
    keyDrivers: string[];
  };
  competitiveAnalysis: Array<{
    name: string;
    type: string;
    strengths: string[];
    weaknesses: string[];
    differentiationOpportunity: string;
  }>;
  technicalLandscape: {
    recommendedStack: string;
    recommendedBlockchain: string;
    blockchainRationale: string;
    keyLibraries: string[];
    knownRisks: string[];
    architectureNotes: string;
  };
  teamAssessment: {
    size: number;
    capability: string;
    timelineFeasibility: string;
    recommendedMvpScope: string;
    skillGaps: string[];
  };
  redFlags: string[];
  opportunities: string[];
  researchConfidence: string;
  notesForWriter: string;
}
