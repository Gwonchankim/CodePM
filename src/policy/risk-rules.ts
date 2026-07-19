import type { RiskLevel } from "../domain/types.js";

export interface RiskRule {
  id: string;
  level: RiskLevel;
  reason: string;
  patterns: RegExp[];
}

export const RISK_RULES: RiskRule[] = [
  {
    id: "auth-or-authorization",
    level: "high",
    reason: "Authentication or authorization may change",
    patterns: [
      /\bauth(?:entication|orization)?\b/i,
      /\boauth\b/i,
      /\bpermission(s)?\b/i,
      /\bsession(s)?\b/i,
      /\bjwt\b/i,
      /\brbac\b/i
    ]
  },
  {
    id: "billing-or-payment",
    level: "high",
    reason: "Payment or billing behavior may change",
    patterns: [/\bbilling\b/i, /\bpayment(s)?\b/i, /\bcheckout\b/i, /\binvoice(s)?\b/i]
  },
  {
    id: "database-or-data-operation",
    level: "high",
    reason: "Database schema or data operations may change",
    patterns: [
      /\bdatabase\b/i,
      /\bmigration(s)?\b/i,
      /\bdatabase\s+schema\b/i,
      /\bdrop\s+table\b/i,
      /\bdelete\s+data\b/i,
      /migrations?\//i,
      /\.sql\b/i
    ]
  },
  {
    id: "secrets-or-env",
    level: "high",
    reason: "Secrets or environment files may change",
    patterns: [
      /\bsecret(s)?\b/i,
      /\bcredential(s)?\b/i,
      /\btoken(s)?\b/i,
      /\bapi[_ -]?key(s)?\b/i,
      /\bprivate\s+key\b/i,
      /\.env(?:\.|$)/i
    ]
  },
  {
    id: "ci-cd-deployment",
    level: "high",
    reason: "CI/CD or deployment configuration may change",
    patterns: [
      /\bci\/cd\b/i,
      /\bdeploy(?:ment)?\b/i,
      /\.github\/workflows\//i,
      /\bworkflow(s)?\b/i
    ]
  },
  {
    id: "production-config",
    level: "high",
    reason: "Production configuration or deploy behavior may change",
    patterns: [
      /\bproduction\s+(config|configuration|deploy|deployment|environment)\b/i,
      /\bprod\s+(config|configuration|deploy|deployment|environment)\b/i,
      /\.env\.production\b/i
    ]
  },
  {
    id: "force-or-destructive-git",
    level: "high",
    reason: "Force push or destructive git command requested",
    patterns: [
      /git\s+push\b[^\n]*--force/i,
      /git\s+reset\s+--hard/i,
      /git\s+clean\s+-fd/i,
      /git\s+branch\s+-D/i
    ]
  },
  {
    id: "public-api-breaking-change",
    level: "high",
    reason: "Public API breaking change may occur",
    patterns: [/\bpublic\s+api\b[^\n]*(breaking|break)/i, /\bbreaking\b[^\n]*\bapi\b/i]
  },
  {
    id: "api-behavior",
    level: "medium",
    reason: "API request or response behavior may change",
    patterns: [
      /\bapi\b/i,
      /\bendpoint(s)?\b/i,
      /\brequest\b/i,
      /\bresponse\b/i,
      /src\/api\//i
    ]
  },
  {
    id: "ui-flow",
    level: "medium",
    reason: "User-facing UI flow may change",
    patterns: [/\bui\b/i, /\buser-facing\b/i, /\bui\s+flow\b/i, /\.tsx\b/i, /src\/ui\//i]
  },
  {
    id: "dependency-change",
    level: "medium",
    reason: "Dependency or package metadata may change",
    patterns: [
      /\bdependency\b/i,
      /\bdependencies\b/i,
      /\bupgrade\b/i,
      /\bnpm\s+install\b/i,
      /package\.json/i,
      /package-lock\.json/i
    ]
  },
  {
    id: "test-infrastructure",
    level: "medium",
    reason: "Test infrastructure may change",
    patterns: [
      /\btest infrastructure\b/i,
      /\btest config\b/i,
      /vitest\.config/i,
      /jest\.config/i,
      /playwright\.config/i
    ]
  },
  {
    id: "build-tooling",
    level: "medium",
    reason: "Build tooling may change",
    patterns: [/tsconfig\.json/i, /\bbuild tooling\b/i, /\bbundler\b/i, /\bvite\.config/i]
  },
  {
    id: "declared-risk",
    level: "low",
    reason: "Proposal declares low risk",
    patterns: []
  }
];
