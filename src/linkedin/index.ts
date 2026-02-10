/**
 * LinkedIn Module
 *
 * LinkedIn talent search and messaging integration using Unipile API.
 */

// Types - Talent Search
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
  // Types - Messaging
  LinkedInMessagingConfig,
  LinkedInChat,
  LinkedInChatListResponse,
  LinkedInMessage,
  LinkedInMessageListResponse,
  LinkedInMessageAttachment,
  LinkedInChatAttendee,
  LinkedInChatAttendeesResponse,
  LinkedInStartChatRequest,
  LinkedInStartChatResponse,
  LinkedInSendMessageRequest,
  LinkedInSendMessageResponse,
  LinkedInCreateWebhookRequest,
  LinkedInCreateWebhookResponse,
  LinkedInWebhookPayload,
  LinkedInUserProfile,
} from "./types.js";

// Client functions - Talent Search
export {
  normalizeBaseUrl,
  linkedInRequest,
  searchLinkedIn,
  getSearchParameters,
  checkLinkedInConnection,
  // Client functions - Messaging
  listChats,
  getMessages,
  getChatAttendees,
  sendMessage,
  startChat,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  getUserProfile,
  listConnections,
  classifyLinkedInError,
  type LinkedInConnection,
  type LinkedInConnectionsResponse,
  type LinkedInErrorType,
  type ClassifiedError,
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

// Agent tools
export {
  createLinkedInTalentSearchTool,
  createLinkedInMessageConnectionTool,
  isLinkedInTalentSearchAvailable,
  getLinkedInTalentSearchStatus,
} from "./tool.js";
