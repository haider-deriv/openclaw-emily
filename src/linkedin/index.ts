/**
 * LinkedIn Module
 *
 * LinkedIn talent search integration using Unipile API.
 */

// Types
export type {
  LinkedInAccountConfig,
  LinkedInConfig,
  LinkedInClientOptions,
  LinkedInPriority,
  LinkedInRoleScope,
  LinkedInCompanyScope,
  LinkedInNetworkDistance,
  LinkedInSearchParameter,
  LinkedInSearchParametersResponse,
  LinkedInSkill,
  LinkedInPosition,
  LinkedInEducation,
  LinkedInPeopleResult,
  LinkedInCompanyResult,
  LinkedInSearchResult,
  LinkedInSearchResponse,
  LinkedInClassicPeopleSearchParams,
  LinkedInRecruiterSearchParams,
  LinkedInSearchRequestBody,
  LinkedInApiError,
} from "./types.js";

// Client functions
export {
  normalizeBaseUrl,
  linkedInRequest,
  searchLinkedIn,
  getSearchParameters,
  checkLinkedInConnection,
} from "./client.js";

// Account management
export type { LinkedInTokenSource, ResolvedLinkedInAccount } from "./accounts.js";

export {
  listLinkedInAccountIds,
  resolveDefaultLinkedInAccountId,
  resolveLinkedInAccount,
  listEnabledLinkedInAccounts,
  buildClientOptions,
  getMissingCredentials,
} from "./accounts.js";

// Search functions
export type { TalentSearchParams, TalentSearchResult, FormattedCandidate } from "./search.js";

export { searchTalent, lookupSearchParameter, formatSearchResultsText } from "./search.js";

// Agent tool
export {
  createLinkedInTalentSearchTool,
  isLinkedInTalentSearchAvailable,
  getLinkedInTalentSearchStatus,
} from "./tool.js";
