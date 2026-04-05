// Ported from gitleaks/gitleaks@256f6479 (2026-04-03). MIT License.
// Custom PII and privacy rules added for Project OS security scanner.
// See: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml

const categories = ['api-key', 'generic-secret', 'private-key', 'pii', 'privacy'];
const ENTROPY_THRESHOLD = 4.5;
const CODE_EXTENSIONS = ['*.ts', '*.js', '*.py', '*.sh', '*.go', '*.rs', '*.java'];

const rules = [
  // === API Keys + Generic + Private Keys (ported from gitleaks) ===
  {
    id: "1password-secret-key",
    description: "Uncovered a possible 1Password secret key, potentially compromising access to secrets in vaults.",
    category: "api-key",
    regex: /\bA3-[A-Z0-9]{6}-(?:(?:[A-Z0-9]{11})|(?:[A-Z0-9]{6}-[A-Z0-9]{5}))-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/,
    keywords: ["a3-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "1password-service-account-token",
    description: "Uncovered a possible 1Password service account token, potentially compromising access to secrets in vaults.",
    category: "api-key",
    regex: /ops_eyJ[a-zA-Z0-9+\/]{250,}={0,3}/,
    keywords: ["ops_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "adafruit-api-key",
    description: "Identified a potential Adafruit API Key, which could lead to unauthorized access to Adafruit services and sensitive data exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:adafruit)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9_-]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["adafruit"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "adobe-client-id",
    description: "Detected a pattern that resembles an Adobe OAuth Web Client ID, posing a risk of compromised Adobe integrations and data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:adobe)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["adobe"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "adobe-client-secret",
    description: "Discovered a potential Adobe Client Secret, which, if exposed, could allow unauthorized Adobe service access and data manipulation.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["p8e-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "age-secret-key",
    description: "Discovered a potential Age encryption tool secret key, risking data decryption and unauthorized access to sensitive information.",
    category: "api-key",
    regex: /AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}/,
    keywords: ["age-secret-key-1"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "airtable-api-key",
    description: "Uncovered a possible Airtable API Key, potentially compromising database access and leading to data leakage or alteration.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:airtable)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{17})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["airtable"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "airtable-personnal-access-token",
    description: "Uncovered a possible Airtable Personal AccessToken, potentially compromising database access and leading to data leakage or alteration.",
    category: "api-key",
    regex: /\b(pat[[:alnum:]]{14}\.[a-f0-9]{64})\b/,
    keywords: ["airtable"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "algolia-api-key",
    description: "Identified an Algolia API Key, which could result in unauthorized search operations and data exposure on Algolia-managed platforms.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:algolia)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["algolia"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "alibaba-access-key-id",
    description: "Detected an Alibaba Cloud AccessKey ID, posing a risk of unauthorized cloud resource access and potential data compromise.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["ltai"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "alibaba-secret-key",
    description: "Discovered a potential Alibaba Cloud Secret Key, potentially allowing unauthorized operations and data access within Alibaba Cloud.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:alibaba)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{30})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["alibaba"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "anthropic-admin-api-key",
    description: "Detected an Anthropic Admin API Key, risking unauthorized access to administrative functions and sensitive AI model configurations.",
    category: "api-key",
    regex: /\b(sk-ant-admin01-[a-zA-Z0-9_\-]{93}AA)(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sk-ant-admin01"],
    severity: "CRITICAL",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "anthropic-api-key",
    description: "Identified an Anthropic API Key, which may compromise AI assistant integrations and expose sensitive data to unauthorized access.",
    category: "api-key",
    regex: /\b(sk-ant-api03-[a-zA-Z0-9_\-]{93}AA)(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sk-ant-api03"],
    severity: "CRITICAL",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "artifactory-api-key",
    description: "Detected an Artifactory api key, posing a risk unauthorized access to the central repository.",
    category: "api-key",
    regex: /\bAKCp[A-Za-z0-9]{69}\b/,
    keywords: ["akcp"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "artifactory-reference-token",
    description: "Detected an Artifactory reference token, posing a risk of impersonation and unauthorized access to the central repository.",
    category: "api-key",
    regex: /\bcmVmd[A-Za-z0-9]{59}\b/,
    keywords: ["cmvmd"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "asana-client-id",
    description: "Discovered a potential Asana Client ID, risking unauthorized access to Asana projects and sensitive task information.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:asana)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9]{16})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["asana"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "asana-client-secret",
    description: "Identified an Asana Client Secret, which could lead to compromised project management integrity and unauthorized access.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:asana)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["asana"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "atlassian-api-token",
    description: "Detected an Atlassian API token, posing a threat to project management and collaboration tool security and data confidentiality.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:(?-i:ATLASSIAN|[Aa]tlassian)|(?-i:CONFLUENCE|[Cc]onfluence)|(?-i:JIRA|[Jj]ira))(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{20}[a-f0-9]{4})(?:[\x60'"\s;]|\\[nr]|$)|\b(ATATT3[A-Za-z0-9_\-=]{186})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["atlassian","confluence","jira","atatt3"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "authress-service-client-access-key",
    description: "Uncovered a possible Authress Service Client Access Key, which may compromise access control services and sensitive data.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["sc_","ext_","scauth_","authress_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "aws-access-token",
    description: "Identified a pattern that may indicate AWS credentials, risking unauthorized cloud resource access and data breaches on AWS platforms.",
    category: "api-key",
    regex: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/,
    keywords: ["a3t","akia","asia","abia","acca"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "aws-amazon-bedrock-api-key-long-lived",
    description: "Identified a pattern that may indicate long-lived Amazon Bedrock API keys, risking unauthorized Amazon Bedrock usage",
    category: "api-key",
    regex: /\b(ABSK[A-Za-z0-9+\/]{109,269}={0,2})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["absk"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "aws-amazon-bedrock-api-key-short-lived",
    description: "Identified a pattern that may indicate short-lived Amazon Bedrock API keys, risking unauthorized Amazon Bedrock usage",
    category: "api-key",
    regex: /bedrock-api-key-YmVkcm9jay5hbWF6b25hd3MuY29t/,
    keywords: ["bedrock-api-key-"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "azure-ad-client-secret",
    description: "Azure AD Client Secret",
    category: "api-key",
    regex: /(?:^|[\\'"\x60\s>=:(,)])([a-zA-Z0-9_~.]{3}\dQ~[a-zA-Z0-9_~.-]{31,34})(?:$|[\\'"\x60\s<),])/,
    keywords: ["q~"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "beamer-api-token",
    description: "Detected a Beamer API token, potentially compromising content management and exposing sensitive notifications and updates.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:beamer)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(b_[a-z0-9=_\-]{44})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["beamer"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "bitbucket-client-id",
    description: "Discovered a potential Bitbucket Client ID, risking unauthorized repository access and potential codebase exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:bitbucket)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["bitbucket"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "bitbucket-client-secret",
    description: "Discovered a potential Bitbucket Client Secret, posing a risk of compromised code repositories and unauthorized access.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:bitbucket)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["bitbucket"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "bittrex-access-key",
    description: "Identified a Bittrex Access Key, which could lead to unauthorized access to cryptocurrency trading accounts and financial loss.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:bittrex)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["bittrex"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "bittrex-secret-key",
    description: "Detected a Bittrex Secret Key, potentially compromising cryptocurrency transactions and financial security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:bittrex)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["bittrex"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "cisco-meraki-api-key",
    description: "Cisco Meraki is a cloud-managed IT solution that provides networking, security, and device management through an easy-to-use interface.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?i:[\w.-]{0,50}?(?:(?-i:[Mm]eraki|MERAKI))(?:[ \t\w.-]{0,20})[\s'"]{0,3})(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{40})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["meraki"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "clickhouse-cloud-api-secret-key",
    description: "Identified a pattern that may indicate clickhouse cloud API secret key, risking unauthorized clickhouse cloud api access and data breaches on ClickHouse Cloud platforms.",
    category: "api-key",
    regex: /\b(4b1d[A-Za-z0-9]{38})\b/,
    keywords: ["4b1d"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "clojars-api-token",
    description: "Uncovered a possible Clojars API token, risking unauthorized access to Clojure libraries and potential code manipulation.",
    category: "api-key",
    regex: /CLOJARS_[a-z0-9]{60}/i,
    keywords: ["clojars_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "cloudflare-api-key",
    description: "Detected a Cloudflare API Key, potentially compromising cloud application deployments and operational security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:cloudflare)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9_-]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["cloudflare"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "cloudflare-global-api-key",
    description: "Detected a Cloudflare Global API Key, potentially compromising cloud application deployments and operational security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:cloudflare)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{37})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["cloudflare"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "cloudflare-origin-ca-key",
    description: "Detected a Cloudflare Origin CA Key, potentially compromising cloud application deployments and operational security.",
    category: "api-key",
    regex: /\b(v1\.0-[a-f0-9]{24}-[a-f0-9]{146})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["cloudflare","v1.0-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "codecov-access-token",
    description: "Found a pattern resembling a Codecov Access Token, posing a risk of unauthorized access to code coverage reports and sensitive data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:codecov)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["codecov"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "cohere-api-token",
    description: "Identified a Cohere Token, posing a risk of unauthorized access to AI services and data manipulation.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?i:[\w.-]{0,50}?(?:cohere|CO_API_KEY)(?:[ \t\w.-]{0,20})[\s'"]{0,3})(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-zA-Z0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["cohere","co_api_key"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "coinbase-access-token",
    description: "Detected a Coinbase Access Token, posing a risk of unauthorized access to cryptocurrency accounts and financial transactions.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:coinbase)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9_-]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["coinbase"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "confluent-access-token",
    description: "Identified a Confluent Access Token, which could compromise access to streaming data platforms and sensitive data flow.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:confluent)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{16})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["confluent"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "confluent-secret-key",
    description: "Found a Confluent Secret Key, potentially risking unauthorized operations and data access within Confluent services.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:confluent)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["confluent"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "contentful-delivery-api-token",
    description: "Discovered a Contentful delivery API token, posing a risk to content management systems and data integrity.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:contentful)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{43})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["contentful"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "curl-auth-header",
    description: "Discovered a potential authorization token provided in a curl command header, which could compromise the curl accessed resource.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["curl"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "curl-auth-user",
    description: "Discovered a potential basic authorization token provided in a curl command, which could compromise the curl accessed resource.",
    category: "api-key",
    regex: /\bcurl\b(?:.*|.*(?:[\r\n]{1,2}.*){1,5})[ \t\n\r](?:-u|--user)(?:=|[ \t]{0,5})("(:[^"]{3,}|[^:"]{3,}:|[^:"]{3,}:[^"]{3,})"|'([^:']{3,}:[^']{3,})'|((?:"[^"]{3,}"|'[^']{3,}'|[\w$@.-]+):(?:"[^"]{3,}"|'[^']{3,}'|[\w${}@.-]+)))(?:\s|\z)/,
    keywords: ["curl"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "databricks-api-token",
    description: "Uncovered a Databricks API token, which may compromise big data analytics platforms and sensitive data processing.",
    category: "api-key",
    regex: /\b(dapi[a-f0-9]{32}(?:-\d)?)(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["dapi"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "datadog-access-token",
    description: "Detected a Datadog Access Token, potentially risking monitoring and analytics data exposure and manipulation.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:datadog)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["datadog"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "defined-networking-api-token",
    description: "Identified a Defined Networking API token, which could lead to unauthorized network operations and data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:dnkey)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(dnkey-[a-z0-9=_\-]{26}-[a-z0-9=_\-]{52})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["dnkey"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "digitalocean-access-token",
    description: "Found a DigitalOcean OAuth Access Token, risking unauthorized cloud resource access and data compromise.",
    category: "api-key",
    regex: /\b(doo_v1_[a-f0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["doo_v1_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "digitalocean-pat",
    description: "Discovered a DigitalOcean Personal Access Token, posing a threat to cloud infrastructure security and data privacy.",
    category: "api-key",
    regex: /\b(dop_v1_[a-f0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["dop_v1_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "digitalocean-refresh-token",
    description: "Uncovered a DigitalOcean OAuth Refresh Token, which could allow prolonged unauthorized access and resource manipulation.",
    category: "api-key",
    regex: /\b(dor_v1_[a-f0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["dor_v1_"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "discord-api-token",
    description: "Detected a Discord API key, potentially compromising communication channels and user data privacy on Discord.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:discord)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["discord"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "discord-client-id",
    description: "Identified a Discord client ID, which may lead to unauthorized integrations and data exposure in Discord applications.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:discord)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9]{18})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["discord"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "discord-client-secret",
    description: "Discovered a potential Discord client secret, risking compromised Discord bot integrations and data leaks.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:discord)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["discord"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "doppler-api-token",
    description: "Discovered a Doppler API token, posing a risk to environment and secrets management security.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["dp.pt."],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "droneci-access-token",
    description: "Detected a Droneci Access Token, potentially compromising continuous integration and deployment workflows.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:droneci)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["droneci"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "dropbox-api-token",
    description: "Identified a Dropbox API secret, which could lead to unauthorized file access and data breaches in Dropbox storage.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:dropbox)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{15})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["dropbox"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "dropbox-long-lived-api-token",
    description: "Found a Dropbox long-lived API token, risking prolonged unauthorized access to cloud storage and sensitive data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:dropbox)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{11}(AAAAAAAAAA)[a-z0-9\-_=]{43})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["dropbox"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "dropbox-short-lived-api-token",
    description: "Discovered a Dropbox short-lived API token, posing a risk of temporary but potentially harmful data access and manipulation.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:dropbox)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(sl\.[a-z0-9\-=_]{135})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["dropbox"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "duffel-api-token",
    description: "Uncovered a Duffel API token, which may compromise travel platform integrations and sensitive customer data.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["duffel_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "dynatrace-api-token",
    description: "Detected a Dynatrace API token, potentially risking application performance monitoring and data exposure.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["dt0c01."],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "easypost-api-token",
    description: "Identified an EasyPost API token, which could lead to unauthorized postal and shipment service access and data exposure.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["ezak"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "easypost-test-api-token",
    description: "Detected an EasyPost test API token, risking exposure of test environments and potentially sensitive shipment data.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["eztk"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "etsy-access-token",
    description: "Found an Etsy Access Token, potentially compromising Etsy shop management and customer data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:(?-i:ETSY|[Ee]tsy))(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{24})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["etsy"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "facebook-access-token",
    description: "Discovered a Facebook Access Token, posing a risk of unauthorized access to Facebook accounts and personal data exposure.",
    category: "api-key",
    regex: /\b(\d{15,16}(\||%)[0-9a-z\-_]{27,40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["facebook"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "facebook-page-access-token",
    description: "Discovered a Facebook Page Access Token, posing a risk of unauthorized access to Facebook accounts and personal data exposure.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["eaam","eaac"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "facebook-secret",
    description: "Discovered a Facebook Application secret, posing a risk of unauthorized access to Facebook accounts and personal data exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:facebook)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["facebook"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "fastly-api-token",
    description: "Uncovered a Fastly API key, which may compromise CDN and edge cloud services, leading to content delivery and security issues.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:fastly)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["fastly"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "finicity-api-token",
    description: "Detected a Finicity API token, potentially risking financial data access and unauthorized financial operations.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:finicity)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["finicity"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "finicity-client-secret",
    description: "Identified a Finicity Client Secret, which could lead to compromised financial service integrations and data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:finicity)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{20})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["finicity"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "finnhub-access-token",
    description: "Found a Finnhub Access Token, risking unauthorized access to financial market data and analytics.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:finnhub)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{20})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["finnhub"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "flickr-access-token",
    description: "Discovered a Flickr Access Token, posing a risk of unauthorized photo management and potential data leakage.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:flickr)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["flickr"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "flutterwave-encryption-key",
    description: "Uncovered a Flutterwave Encryption Key, which may compromise payment processing and sensitive financial information.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["flwseck_test"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "flutterwave-public-key",
    description: "Detected a Finicity Public Key, potentially exposing public cryptographic operations and integrations.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["flwpubk_test"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "flutterwave-secret-key",
    description: "Identified a Flutterwave Secret Key, risking unauthorized financial transactions and data breaches.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["flwseck_test"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "flyio-access-token",
    description: "Uncovered a Fly.io API key",
    category: "api-key",
    regex: /\b((?:fo1_[\w-]{43}|fm1[ar]_[a-zA-Z0-9+\\/]{100,}={0,3}|fm2_[a-zA-Z0-9+\\/]{100,}={0,3}))(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["fo1_","fm1","fm2_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "frameio-api-token",
    description: "Found a Frame.io API token, potentially compromising video collaboration and project management.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["fio-u-"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "freemius-secret-key",
    description: "Detected a Freemius secret key, potentially exposing sensitive information.",
    category: "api-key",
    regex: /["']secret_key["']\s*=>\s*["'](sk_[\S]{29})["']/i,
    keywords: ["secret_key"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "freshbooks-access-token",
    description: "Discovered a Freshbooks Access Token, posing a risk to accounting software access and sensitive financial data exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:freshbooks)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["freshbooks"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gcp-api-key",
    description: "Uncovered a GCP API key, which could lead to unauthorized access to Google Cloud services and data breaches.",
    category: "api-key",
    regex: /\b(AIza[\w-]{35})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["aiza"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "generic-api-key",
    description: "Detected a Generic API Key, potentially exposing access to various services and sensitive operations.",
    category: "generic-secret",
    regex: /[\w.-]{0,50}?(?:access|auth|(?-i:[Aa]pi|API)|credential|creds|key|passw(?:or)?d|secret|token)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+\/]{11,}={0,3})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["access","api","auth","key","credential","creds","passwd","password","secret","token"],
    severity: "MEDIUM",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "github-app-token",
    description: "Identified a GitHub App Token, which may compromise GitHub application integrations and source code security.",
    category: "api-key",
    regex: /(?:ghu|ghs)_[0-9a-zA-Z]{36}/,
    keywords: ["ghu_","ghs_"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "github-fine-grained-pat",
    description: "Found a GitHub Fine-Grained Personal Access Token, risking unauthorized repository access and code manipulation.",
    category: "api-key",
    regex: /github_pat_\w{82}/,
    keywords: ["github_pat_"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "github-oauth",
    description: "Discovered a GitHub OAuth Access Token, posing a risk of compromised GitHub account integrations and data leaks.",
    category: "api-key",
    regex: /gho_[0-9a-zA-Z]{36}/,
    keywords: ["gho_"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "github-pat",
    description: "Uncovered a GitHub Personal Access Token, potentially leading to unauthorized repository access and sensitive content exposure.",
    category: "api-key",
    regex: /ghp_[0-9a-zA-Z]{36}/,
    keywords: ["ghp_"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "github-refresh-token",
    description: "Detected a GitHub Refresh Token, which could allow prolonged unauthorized access to GitHub services.",
    category: "api-key",
    regex: /ghr_[0-9a-zA-Z]{36}/,
    keywords: ["ghr_"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-cicd-job-token",
    description: "Identified a GitLab CI/CD Job Token, potential access to projects and some APIs on behalf of a user while the CI job is running.",
    category: "api-key",
    regex: /glcbt-[0-9a-zA-Z]{1,5}_[0-9a-zA-Z_-]{20}/,
    keywords: ["glcbt-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-deploy-token",
    description: "Identified a GitLab Deploy Token, risking access to repositories, packages and containers with write access.",
    category: "api-key",
    regex: /gldt-[0-9a-zA-Z_\-]{20}/,
    keywords: ["gldt-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-feature-flag-client-token",
    description: "Identified a GitLab feature flag client token, risks exposing user lists and features flags used by an application.",
    category: "api-key",
    regex: /glffct-[0-9a-zA-Z_\-]{20}/,
    keywords: ["glffct-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-feed-token",
    description: "Identified a GitLab feed token, risking exposure of user data.",
    category: "api-key",
    regex: /glft-[0-9a-zA-Z_\-]{20}/,
    keywords: ["glft-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-incoming-mail-token",
    description: "Identified a GitLab incoming mail token, risking manipulation of data sent by mail.",
    category: "api-key",
    regex: /glimt-[0-9a-zA-Z_\-]{25}/,
    keywords: ["glimt-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-kubernetes-agent-token",
    description: "Identified a GitLab Kubernetes Agent token, risking access to repos and registry of projects connected via agent.",
    category: "api-key",
    regex: /glagent-[0-9a-zA-Z_\-]{50}/,
    keywords: ["glagent-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-oauth-app-secret",
    description: "Identified a GitLab OIDC Application Secret, risking access to apps using GitLab as authentication provider.",
    category: "api-key",
    regex: /gloas-[0-9a-zA-Z_\-]{64}/,
    keywords: ["gloas-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-pat",
    description: "Identified a GitLab Personal Access Token, risking unauthorized access to GitLab repositories and codebase exposure.",
    category: "api-key",
    regex: /glpat-[\w-]{20}/,
    keywords: ["glpat-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-pat-routable",
    description: "Identified a GitLab Personal Access Token (routable), risking unauthorized access to GitLab repositories and codebase exposure.",
    category: "api-key",
    regex: /\bglpat-[0-9a-zA-Z_-]{27,300}\.[0-9a-z]{2}[0-9a-z]{7}\b/,
    keywords: ["glpat-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-ptt",
    description: "Found a GitLab Pipeline Trigger Token, potentially compromising continuous integration workflows and project security.",
    category: "api-key",
    regex: /glptt-[0-9a-f]{40}/,
    keywords: ["glptt-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-rrt",
    description: "Discovered a GitLab Runner Registration Token, posing a risk to CI/CD pipeline integrity and unauthorized access.",
    category: "api-key",
    regex: /GR1348941[\w-]{20}/,
    keywords: ["gr1348941"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-runner-authentication-token",
    description: "Discovered a GitLab Runner Authentication Token, posing a risk to CI/CD pipeline integrity and unauthorized access.",
    category: "api-key",
    regex: /glrt-[0-9a-zA-Z_\-]{20}/,
    keywords: ["glrt-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-runner-authentication-token-routable",
    description: "Discovered a GitLab Runner Authentication Token (Routable), posing a risk to CI/CD pipeline integrity and unauthorized access.",
    category: "api-key",
    regex: /\bglrt-t\d_[0-9a-zA-Z_\-]{27,300}\.[0-9a-z]{2}[0-9a-z]{7}\b/,
    keywords: ["glrt-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-scim-token",
    description: "Discovered a GitLab SCIM Token, posing a risk to unauthorized access for a organization or instance.",
    category: "api-key",
    regex: /glsoat-[0-9a-zA-Z_\-]{20}/,
    keywords: ["glsoat-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitlab-session-cookie",
    description: "Discovered a GitLab Session Cookie, posing a risk to unauthorized access to a user account.",
    category: "api-key",
    regex: /_gitlab_session=[0-9a-z]{32}/,
    keywords: ["_gitlab_session="],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gitter-access-token",
    description: "Uncovered a Gitter Access Token, which may lead to unauthorized access to chat and communication services.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:gitter)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9_-]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["gitter"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "gocardless-api-token",
    description: "Detected a GoCardless API token, potentially risking unauthorized direct debit payment operations and financial data exposure.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["live_","gocardless"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "grafana-api-key",
    description: "Identified a Grafana API key, which could compromise monitoring dashboards and sensitive data analytics.",
    category: "api-key",
    regex: /\b(eyJrIjoi[A-Za-z0-9]{70,400}={0,3})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["eyjrijoi"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "grafana-cloud-api-token",
    description: "Found a Grafana cloud API token, risking unauthorized access to cloud-based monitoring services and data exposure.",
    category: "api-key",
    regex: /\b(glc_[A-Za-z0-9+\/]{32,400}={0,3})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["glc_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "grafana-service-account-token",
    description: "Discovered a Grafana service account token, posing a risk of compromised monitoring services and data integrity.",
    category: "api-key",
    regex: /\b(glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["glsa_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "harness-api-key",
    description: "Identified a Harness Access Token (PAT or SAT), risking unauthorized access to a Harness account.",
    category: "api-key",
    regex: /(?:pat|sat)\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9]{24}\.[a-zA-Z0-9]{20}/,
    keywords: ["pat.","sat."],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "hashicorp-tf-api-token",
    description: "Uncovered a HashiCorp Terraform user/org API token, which may lead to unauthorized infrastructure management and security breaches.",
    category: "api-key",
    regex: /[a-z0-9]{14}\.(?-i:atlasv1)\.[a-z0-9\-_=]{60,70}/i,
    keywords: ["atlasv1"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "hashicorp-tf-password",
    description: "Identified a HashiCorp Terraform password field, risking unauthorized infrastructure configuration and security breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:administrator_login_password|password)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}("[a-z0-9=_\-]{8,20}")(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["administrator_login_password","password"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "heroku-api-key",
    description: "Detected a Heroku API Key, potentially compromising cloud application deployments and operational security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:heroku)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["heroku"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "heroku-api-key-v2",
    description: "Detected a Heroku API Key, potentially compromising cloud application deployments and operational security.",
    category: "api-key",
    regex: /\b((HRKU-AA[0-9a-zA-Z_-]{58}))(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["hrku-aa"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "hubspot-api-key",
    description: "Found a HubSpot API Token, posing a risk to CRM data integrity and unauthorized marketing operations.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:hubspot)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["hubspot"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "huggingface-access-token",
    description: "Discovered a Hugging Face Access token, which could lead to unauthorized access to AI models and sensitive data.",
    category: "api-key",
    regex: /\b(hf_(?i:[a-z]{34}))(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["hf_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "huggingface-organization-api-token",
    description: "Uncovered a Hugging Face Organization API token, potentially compromising AI organization accounts and associated data.",
    category: "api-key",
    regex: /\b(api_org_(?i:[a-z]{34}))(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["api_org_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "infracost-api-token",
    description: "Detected an Infracost API Token, risking unauthorized access to cloud cost estimation tools and financial data.",
    category: "api-key",
    regex: /\b(ico-[a-zA-Z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["ico-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "intercom-api-key",
    description: "Identified an Intercom API Token, which could compromise customer communication channels and data privacy.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:intercom)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{60})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["intercom"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "intra42-client-secret",
    description: "Found a Intra42 client secret, which could lead to unauthorized access to the 42School API and sensitive data.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["intra","s-s4t2ud-","s-s4t2af-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "jfrog-api-key",
    description: "Found a JFrog API Key, posing a risk of unauthorized access to software artifact repositories and build pipelines.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:jfrog|artifactory|bintray|xray)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{73})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["jfrog","artifactory","bintray","xray"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "jfrog-identity-token",
    description: "Discovered a JFrog Identity Token, potentially compromising access to JFrog services and sensitive software artifacts.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:jfrog|artifactory|bintray|xray)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["jfrog","artifactory","bintray","xray"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "jwt",
    description: "Uncovered a JSON Web Token, which may lead to unauthorized access to web applications and sensitive user data.",
    category: "api-key",
    regex: /\b(ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9\\/\\_-]{17,}\.(?:[a-zA-Z0-9\\/\\_-]{10,}={0,2})?)(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["ey"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "jwt-base64",
    description: "Detected a Base64-encoded JSON Web Token, posing a risk of exposing encoded authentication and data exchange information.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["zxlk"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "kraken-access-token",
    description: "Identified a Kraken Access Token, potentially compromising cryptocurrency trading accounts and financial security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:kraken)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9\\/=_\+\-]{80,90})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["kraken"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "kubernetes-secret-yaml",
    description: "Possible Kubernetes Secret detected, posing a risk of leaking credentials/tokens from your deployments",
    category: "api-key",
    regex: /(?:\bkind:[ \t]*["']?\bsecret\b["']?(?s:.){0,200}?\bdata:(?s:.){0,100}?\s+([\w.-]+:(?:[ \t]*(?:\||>[-+]?)\s+)?[ \t]*(?:["']?[a-z0-9+\/]{10,}={0,3}["']?|\{\{[ \t\w"|$:=,.-]+}}|""|''))|\bdata:(?s:.){0,100}?\s+([\w.-]+:(?:[ \t]*(?:\||>[-+]?)\s+)?[ \t]*(?:["']?[a-z0-9+\/]{10,}={0,3}["']?|\{\{[ \t\w"|$:=,.-]+}}|""|''))(?s:.){0,200}?\bkind:[ \t]*["']?\bsecret\b["']?)/i,
    keywords: ["secret"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "kucoin-access-token",
    description: "Found a Kucoin Access Token, risking unauthorized access to cryptocurrency exchange services and transactions.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:kucoin)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{24})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["kucoin"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "kucoin-secret-key",
    description: "Discovered a Kucoin Secret Key, which could lead to compromised cryptocurrency operations and financial data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:kucoin)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["kucoin"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "launchdarkly-access-token",
    description: "Uncovered a Launchdarkly Access Token, potentially compromising feature flag management and application functionality.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:launchdarkly)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["launchdarkly"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "linear-api-key",
    description: "Detected a Linear API Token, posing a risk to project management tools and sensitive task data.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["lin_api_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "linear-client-secret",
    description: "Identified a Linear Client Secret, which may compromise secure integrations and sensitive project management data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:linear)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["linear"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "linkedin-client-id",
    description: "Found a LinkedIn Client ID, risking unauthorized access to LinkedIn integrations and professional data exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:linked[_-]?in)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{14})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["linkedin","linked_in","linked-in"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "linkedin-client-secret",
    description: "Discovered a LinkedIn Client secret, potentially compromising LinkedIn application integrations and user data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:linked[_-]?in)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{16})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["linkedin","linked_in","linked-in"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "lob-api-key",
    description: "Uncovered a Lob API Key, which could lead to unauthorized access to mailing and address verification services.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:lob)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}((live|test)_[a-f0-9]{35})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["test_","live_"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "lob-pub-api-key",
    description: "Detected a Lob Publishable API Key, posing a risk of exposing mail and print service integrations.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:lob)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}((test|live)_pub_[a-f0-9]{31})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["test_pub","live_pub","_pub"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "looker-client-id",
    description: "Found a Looker Client ID, risking unauthorized access to a Looker account and exposing sensitive data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:looker)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{20})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["looker"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "looker-client-secret",
    description: "Found a Looker Client Secret, risking unauthorized access to a Looker account and exposing sensitive data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:looker)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{24})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["looker"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "mailchimp-api-key",
    description: "Identified a Mailchimp API key, potentially compromising email marketing campaigns and subscriber data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:MailchimpSDK.initialize|mailchimp)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{32}-us\d\d)(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["mailchimp"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "mailgun-private-api-token",
    description: "Found a Mailgun private API token, risking unauthorized email service operations and data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:mailgun)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(key-[a-f0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["mailgun"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "mailgun-pub-key",
    description: "Discovered a Mailgun public validation key, which could expose email verification processes and associated data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:mailgun)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(pubkey-[a-f0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["mailgun"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "mailgun-signing-key",
    description: "Uncovered a Mailgun webhook signing key, potentially compromising email automation and data integrity.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:mailgun)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-h0-9]{32}-[a-h0-9]{8}-[a-h0-9]{8})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["mailgun"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "mapbox-api-token",
    description: "Detected a MapBox API token, posing a risk to geospatial services and sensitive location data exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:mapbox)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(pk\.[a-z0-9]{60}\.[a-z0-9]{22})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["mapbox"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "mattermost-access-token",
    description: "Identified a Mattermost Access Token, which may compromise team communication channels and data privacy.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:mattermost)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{26})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["mattermost"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "maxmind-license-key",
    description: "Discovered a potential MaxMind license key.",
    category: "api-key",
    regex: /\b([A-Za-z0-9]{6}_[A-Za-z0-9]{29}_mmk)(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["_mmk"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "messagebird-api-token",
    description: "Found a MessageBird API token, risking unauthorized access to communication platforms and message data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:message[_-]?bird)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{25})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["messagebird","message-bird","message_bird"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "messagebird-client-id",
    description: "Discovered a MessageBird client ID, potentially compromising API integrations and sensitive communication data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:message[_-]?bird)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["messagebird","message-bird","message_bird"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "microsoft-teams-webhook",
    description: "Uncovered a Microsoft Teams Webhook, which could lead to unauthorized access to team collaboration tools and data leaks.",
    category: "api-key",
    regex: /https:\/\/[a-z0-9]+\.webhook\.office\.com\/webhookb2\/[a-z0-9]{8}-([a-z0-9]{4}-){3}[a-z0-9]{12}@[a-z0-9]{8}-([a-z0-9]{4}-){3}[a-z0-9]{12}\/IncomingWebhook\/[a-z0-9]{32}\/[a-z0-9]{8}-([a-z0-9]{4}-){3}[a-z0-9]{12}/,
    keywords: ["webhook.office.com","webhookb2","incomingwebhook"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "netlify-access-token",
    description: "Detected a Netlify Access Token, potentially compromising web hosting services and site management.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:netlify)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{40,46})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["netlify"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "new-relic-browser-api-token",
    description: "Identified a New Relic ingest browser API token, risking unauthorized access to application performance data and analytics.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:new-relic|newrelic|new_relic)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(NRJS-[a-f0-9]{19})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["nrjs-"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "new-relic-insert-key",
    description: "Discovered a New Relic insight insert key, compromising data injection into the platform.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:new-relic|newrelic|new_relic)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(NRII-[a-z0-9-]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["nrii-"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "new-relic-user-api-id",
    description: "Found a New Relic user API ID, posing a risk to application monitoring services and data integrity.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:new-relic|newrelic|new_relic)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["new-relic","newrelic","new_relic"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "new-relic-user-api-key",
    description: "Discovered a New Relic user API Key, which could lead to compromised application insights and performance monitoring.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:new-relic|newrelic|new_relic)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(NRAK-[a-z0-9]{27})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["nrak"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "notion-api-token",
    description: "Notion API token",
    category: "api-key",
    regex: /\b(ntn_[0-9]{11}[A-Za-z0-9]{32}[A-Za-z0-9]{3})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["ntn_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "npm-access-token",
    description: "Uncovered an npm access token, potentially compromising package management and code repository access.",
    category: "api-key",
    regex: /\b(npm_[a-z0-9]{36})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["npm_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "nuget-config-password",
    description: "Identified a password within a Nuget config file, potentially compromising package management access.",
    category: "api-key",
    regex: /<add key=\"(?:(?:ClearText)?Password)\"\s*value=\"(.{8,})\"\s*\/>/i,
    keywords: ["<add key="],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "nytimes-access-token",
    description: "Detected a Nytimes Access Token, risking unauthorized access to New York Times APIs and content services.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:nytimes|new-york-times,|newyorktimes)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9=_\-]{32})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["nytimes","new-york-times","newyorktimes"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "octopus-deploy-api-key",
    description: "Discovered a potential Octopus Deploy API key, risking application deployments and operational security.",
    category: "api-key",
    regex: /\b(API-[A-Z0-9]{26})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["api-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "okta-access-token",
    description: "Identified an Okta Access Token, which may compromise identity management services and user authentication data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?i:[\w.-]{0,50}?(?:(?-i:[Oo]kta|OKTA))(?:[ \t\w.-]{0,20})[\s'"]{0,3})(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(00[\w=\-]{40})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["okta"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "openai-api-key",
    description: "Found an OpenAI API Key, posing a risk of unauthorized access to AI services and data manipulation.",
    category: "api-key",
    regex: /\b(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["t3blbkfj"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "openshift-user-token",
    description: "Found an OpenShift user token, potentially compromising an OpenShift/Kubernetes cluster.",
    category: "api-key",
    regex: /\b(sha256~[\w-]{43})(?:[^\w-]|\z)/,
    keywords: ["sha256~"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "perplexity-api-key",
    description: "Detected a Perplexity API key, which could lead to unauthorized access to Perplexity AI services and data exposure.",
    category: "api-key",
    regex: /\b(pplx-[a-zA-Z0-9]{48})(?:[\x60'"\s;]|\\[nr]|$|\b)/,
    keywords: ["pplx-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "pkcs12-file",
    description: "Found a PKCS #12 file, which commonly contain bundled private keys.",
    category: "private-key",
    regex: null /* path-only rule */,
    keywords: [],
    severity: "CRITICAL",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "plaid-api-token",
    description: "Discovered a Plaid API Token, potentially compromising financial data aggregation and banking services.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:plaid)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(access-(?:sandbox|development|production)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["plaid"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "plaid-client-id",
    description: "Uncovered a Plaid Client ID, which could lead to unauthorized financial service integrations and data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:plaid)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{24})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["plaid"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "plaid-secret-key",
    description: "Detected a Plaid Secret key, risking unauthorized access to financial accounts and sensitive transaction data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:plaid)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{30})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["plaid"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "planetscale-api-token",
    description: "Identified a PlanetScale API token, potentially compromising database management and operations.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["pscale_tkn_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "planetscale-oauth-token",
    description: "Found a PlanetScale OAuth token, posing a risk to database access control and sensitive data integrity.",
    category: "api-key",
    regex: /\b(pscale_oauth_[\w=\.-]{32,64})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["pscale_oauth_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "planetscale-password",
    description: "Discovered a PlanetScale password, which could lead to unauthorized database operations and data breaches.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["pscale_pw_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "postman-api-token",
    description: "Uncovered a Postman API token, potentially compromising API testing and development workflows.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["pmak-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "prefect-api-token",
    description: "Detected a Prefect API token, risking unauthorized access to workflow management and automation services.",
    category: "api-key",
    regex: /\b(pnu_[a-zA-Z0-9]{36})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["pnu_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "private-key",
    description: "Identified a Private Key, which may compromise cryptographic security and sensitive data encryption.",
    category: "private-key",
    regex: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S-]{64,}?KEY(?: BLOCK)?-----/i,
    keywords: ["-----begin"],
    severity: "CRITICAL",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "privateai-api-token",
    description: "Identified a PrivateAI Token, posing a risk of unauthorized access to AI services and data manipulation.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?i:[\w.-]{0,50}?(?:private[_-]?ai)(?:[ \t\w.-]{0,20})[\s'"]{0,3})(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{32})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["privateai","private_ai","private-ai"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "pulumi-api-token",
    description: "Found a Pulumi API token, posing a risk to infrastructure as code services and cloud resource management.",
    category: "api-key",
    regex: /\b(pul-[a-f0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["pul-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "pypi-upload-token",
    description: "Discovered a PyPI upload token, potentially compromising Python package distribution and repository integrity.",
    category: "api-key",
    regex: /pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}/,
    keywords: ["pypi-ageichlwas5vcmc"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "rapidapi-access-token",
    description: "Uncovered a RapidAPI Access Token, which could lead to unauthorized access to various APIs and data services.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:rapidapi)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9_-]{50})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["rapidapi"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "readme-api-token",
    description: "Detected a Readme API token, risking unauthorized documentation management and content exposure.",
    category: "api-key",
    regex: /\b(rdme_[a-z0-9]{70})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["rdme_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "rubygems-api-token",
    description: "Identified a Rubygem API token, potentially compromising Ruby library distribution and package management.",
    category: "api-key",
    regex: /\b(rubygems_[a-f0-9]{48})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["rubygems_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "scalingo-api-token",
    description: "Found a Scalingo API token, posing a risk to cloud platform services and application deployment security.",
    category: "api-key",
    regex: /\b(tk-us-[\w-]{48})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["tk-us-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sendbird-access-id",
    description: "Discovered a Sendbird Access ID, which could compromise chat and messaging platform integrations.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:sendbird)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["sendbird"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sendbird-access-token",
    description: "Uncovered a Sendbird Access Token, potentially risking unauthorized access to communication services and user data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:sendbird)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["sendbird"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sendgrid-api-token",
    description: "Detected a SendGrid API token, posing a risk of unauthorized email service operations and data exposure.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["sg."],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sendinblue-api-token",
    description: "Identified a Sendinblue API token, which may compromise email marketing services and subscriber data privacy.",
    category: "api-key",
    regex: null /* regex compile error */,
    keywords: ["xkeysib-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sentry-access-token",
    description: "Found a Sentry.io Access Token (old format), risking unauthorized access to error tracking services and sensitive application data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:sentry)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["sentry"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sentry-org-token",
    description: "Found a Sentry.io Organization Token, risking unauthorized access to error tracking services and sensitive application data.",
    category: "api-key",
    regex: /\bsntrys_eyJpYXQiO[a-zA-Z0-9+\/]{10,200}(?:LCJyZWdpb25fdXJs|InJlZ2lvbl91cmwi|cmVnaW9uX3VybCI6)[a-zA-Z0-9+\/]{10,200}={0,2}_[a-zA-Z0-9+\/]{43}(?:[^a-zA-Z0-9+\/]|\z)/,
    keywords: ["sntrys_eyjpyxqio"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sentry-user-token",
    description: "Found a Sentry.io User Token, risking unauthorized access to error tracking services and sensitive application data.",
    category: "api-key",
    regex: /\b(sntryu_[a-f0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sntryu_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "settlemint-application-access-token",
    description: "Found a Settlemint Application Access Token.",
    category: "api-key",
    regex: /\b(sm_aat_[a-zA-Z0-9]{16})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sm_aat"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "settlemint-personal-access-token",
    description: "Found a Settlemint Personal Access Token.",
    category: "api-key",
    regex: /\b(sm_pat_[a-zA-Z0-9]{16})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sm_pat"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "settlemint-service-access-token",
    description: "Found a Settlemint Service Access Token.",
    category: "api-key",
    regex: /\b(sm_sat_[a-zA-Z0-9]{16})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sm_sat"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "shippo-api-token",
    description: "Discovered a Shippo API token, potentially compromising shipping services and customer order data.",
    category: "api-key",
    regex: /\b(shippo_(?:live|test)_[a-fA-F0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["shippo_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "shopify-access-token",
    description: "Uncovered a Shopify access token, which could lead to unauthorized e-commerce platform access and data breaches.",
    category: "api-key",
    regex: /shpat_[a-fA-F0-9]{32}/,
    keywords: ["shpat_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "shopify-custom-access-token",
    description: "Detected a Shopify custom access token, potentially compromising custom app integrations and e-commerce data security.",
    category: "api-key",
    regex: /shpca_[a-fA-F0-9]{32}/,
    keywords: ["shpca_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "shopify-private-app-access-token",
    description: "Identified a Shopify private app access token, risking unauthorized access to private app data and store operations.",
    category: "api-key",
    regex: /shppa_[a-fA-F0-9]{32}/,
    keywords: ["shppa_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "shopify-shared-secret",
    description: "Found a Shopify shared secret, posing a risk to application authentication and e-commerce platform security.",
    category: "api-key",
    regex: /shpss_[a-fA-F0-9]{32}/,
    keywords: ["shpss_"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sidekiq-secret",
    description: "Discovered a Sidekiq Secret, which could lead to compromised background job processing and application data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:BUNDLE_ENTERPRISE__CONTRIBSYS__COM|BUNDLE_GEMS__CONTRIBSYS__COM)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{8}:[a-f0-9]{8})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["bundle_enterprise__contribsys__com","bundle_gems__contribsys__com"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sidekiq-sensitive-url",
    description: "Uncovered a Sidekiq Sensitive URL, potentially exposing internal job queues and sensitive operation details.",
    category: "api-key",
    regex: /\bhttps?:\/\/([a-f0-9]{8}:[a-f0-9]{8})@(?:gems.contribsys.com|enterprise.contribsys.com)(?:[\\/|\#|\?|:]|$)/i,
    keywords: ["gems.contribsys.com","enterprise.contribsys.com"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-app-token",
    description: "Detected a Slack App-level token, risking unauthorized access to Slack applications and workspace data.",
    category: "api-key",
    regex: /xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+/i,
    keywords: ["xapp"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-bot-token",
    description: "Identified a Slack Bot token, which may compromise bot integrations and communication channel security.",
    category: "api-key",
    regex: /xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/,
    keywords: ["xoxb"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-config-access-token",
    description: "Found a Slack Configuration access token, posing a risk to workspace configuration and sensitive data access.",
    category: "api-key",
    regex: /xoxe.xox[bp]-\d-[A-Z0-9]{163,166}/i,
    keywords: ["xoxe.xoxb-","xoxe.xoxp-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-config-refresh-token",
    description: "Discovered a Slack Configuration refresh token, potentially allowing prolonged unauthorized access to configuration settings.",
    category: "api-key",
    regex: /xoxe-\d-[A-Z0-9]{146}/i,
    keywords: ["xoxe-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-legacy-bot-token",
    description: "Uncovered a Slack Legacy bot token, which could lead to compromised legacy bot operations and data exposure.",
    category: "api-key",
    regex: /xoxb-[0-9]{8,14}-[a-zA-Z0-9]{18,26}/,
    keywords: ["xoxb"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-legacy-token",
    description: "Detected a Slack Legacy token, risking unauthorized access to older Slack integrations and user data.",
    category: "api-key",
    regex: /xox[os]-\d+-\d+-\d+-[a-fA-F\d]+/,
    keywords: ["xoxo","xoxs"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-legacy-workspace-token",
    description: "Identified a Slack Legacy Workspace token, potentially compromising access to workspace data and legacy features.",
    category: "api-key",
    regex: /xox[ar]-(?:\d-)?[0-9a-zA-Z]{8,48}/,
    keywords: ["xoxa","xoxr"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-user-token",
    description: "Found a Slack User token, posing a risk of unauthorized user impersonation and data access within Slack workspaces.",
    category: "api-key",
    regex: /xox[pe](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}/,
    keywords: ["xoxp-","xoxe-"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "slack-webhook-url",
    description: "Discovered a Slack Webhook, which could lead to unauthorized message posting and data leakage in Slack channels.",
    category: "api-key",
    regex: /(?:https?:\/\/)?hooks.slack.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+\/]{43,56}/,
    keywords: ["hooks.slack.com"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "snyk-api-token",
    description: "Uncovered a Snyk API token, potentially compromising software vulnerability scanning and code security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:snyk[_.-]?(?:(?:api|oauth)[_.-]?)?(?:key|token))(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["snyk"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sonar-api-token",
    description: "Uncovered a Sonar API token, potentially compromising software vulnerability scanning and code security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:sonar[_.-]?(login|token))(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}((?:squ_|sqp_|sqa_)?[a-z0-9=_\-]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["sonar"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sourcegraph-access-token",
    description: "Sourcegraph is a code search and navigation engine.",
    category: "api-key",
    regex: /\b(\b(sgp_(?:[a-fA-F0-9]{16}|local)_[a-fA-F0-9]{40}|sgp_[a-fA-F0-9]{40}|[a-fA-F0-9]{40})\b)(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["sgp_","sourcegraph"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "square-access-token",
    description: "Detected a Square Access Token, risking unauthorized payment processing and financial transaction exposure.",
    category: "api-key",
    regex: /\b((?:EAAA|sq0atp-)[\w-]{22,60})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sq0atp-","eaaa"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "squarespace-access-token",
    description: "Identified a Squarespace Access Token, which may compromise website management and content control on Squarespace.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:squarespace)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["squarespace"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "stripe-access-token",
    description: "Found a Stripe Access Token, posing a risk to payment processing services and sensitive financial data.",
    category: "api-key",
    regex: /\b((?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sk_test","sk_live","sk_prod","rk_test","rk_live","rk_prod"],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sumologic-access-id",
    description: "Discovered a SumoLogic Access ID, potentially compromising log management services and data analytics integrity.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?i:[\w.-]{0,50}?(?:(?-i:[Ss]umo|SUMO))(?:[ \t\w.-]{0,20})[\s'"]{0,3})(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(su[a-zA-Z0-9]{12})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["sumo"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "sumologic-access-token",
    description: "Uncovered a SumoLogic Access Token, which could lead to unauthorized access to log data and analytics insights.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:(?-i:[Ss]umo|SUMO))(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{64})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["sumo"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "telegram-bot-api-token",
    description: "Detected a Telegram Bot API Token, risking unauthorized bot operations and message interception on Telegram.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:telegr)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9]{5,16}:(?-i:A)[a-z0-9_\-]{34})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["telegr"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "travisci-access-token",
    description: "Identified a Travis CI Access Token, potentially compromising continuous integration services and codebase security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:travis)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{22})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["travis"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twilio-api-key",
    description: "Found a Twilio API Key, posing a risk to communication services and sensitive customer interaction data.",
    category: "api-key",
    regex: /SK[0-9a-fA-F]{32}/,
    keywords: ["sk"],
    severity: "HIGH",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twitch-api-token",
    description: "Discovered a Twitch API token, which could compromise streaming services and account integrations.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:twitch)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{30})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["twitch"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twitter-access-secret",
    description: "Uncovered a Twitter Access Secret, potentially risking unauthorized Twitter integrations and data breaches.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:twitter)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{45})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["twitter"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twitter-access-token",
    description: "Detected a Twitter Access Token, posing a risk of unauthorized account operations and social media data exposure.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:twitter)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([0-9]{15,25}-[a-zA-Z0-9]{20,40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["twitter"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twitter-api-key",
    description: "Identified a Twitter API Key, which may compromise Twitter application integrations and user data security.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:twitter)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{25})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["twitter"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twitter-api-secret",
    description: "Found a Twitter API Secret, risking the security of Twitter app integrations and sensitive data access.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:twitter)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{50})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["twitter"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "twitter-bearer-token",
    description: "Discovered a Twitter Bearer Token, potentially compromising API access and data retrieval from Twitter.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:twitter)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(A{22}[a-zA-Z0-9%]{80,100})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["twitter"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "typeform-api-token",
    description: "Uncovered a Typeform API token, which could lead to unauthorized survey management and data collection.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:typeform)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(tfp_[a-z0-9\-_\.=]{59})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["tfp_"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "vault-batch-token",
    description: "Detected a Vault Batch Token, risking unauthorized access to secret management services and sensitive data.",
    category: "api-key",
    regex: /\b(hvb\.[\w-]{138,300})(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["hvb."],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "vault-service-token",
    description: "Identified a Vault Service Token, potentially compromising infrastructure security and access to sensitive credentials.",
    category: "api-key",
    regex: /\b((?:hvs\.[\w-]{90,120}|s\.(?i:[a-z0-9]{24})))(?:[\x60'"\s;]|\\[nr]|$)/,
    keywords: ["hvs.","s."],
    severity: "CRITICAL",
    entropy: true,
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "yandex-access-token",
    description: "Found a Yandex Access Token, posing a risk to Yandex service integrations and user data privacy.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:yandex)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(t1\.[A-Z0-9a-z_-]+[=]{0,2}\.[A-Z0-9a-z_-]{86}[=]{0,2})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["yandex"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "yandex-api-key",
    description: "Discovered a Yandex API Key, which could lead to unauthorized access to Yandex services and data manipulation.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:yandex)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(AQVN[A-Za-z0-9_\-]{35,38})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["yandex"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "yandex-aws-access-token",
    description: "Uncovered a Yandex AWS Access Token, potentially compromising cloud resource access and data security on Yandex Cloud.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:yandex)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}(YC[a-zA-Z0-9_\-]{38})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["yandex"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  {
    id: "zendesk-secret-key",
    description: "Detected a Zendesk Secret Key, risking unauthorized access to customer support services and sensitive ticketing data.",
    category: "api-key",
    regex: /[\w.-]{0,50}?(?:zendesk)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)/i,
    keywords: ["zendesk"],
    severity: "HIGH",
    allowlist: { regexes: [], paths: [], stopwords: [] },
    testCases: []
  },
  // === PII ===
  {
    id: 'pii-email',
    description: 'Email address',
    category: 'pii',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    keywords: ['@'],
    severity: 'MEDIUM',
    pathScope: 'non-code',
    pathScopeSkip: CODE_EXTENSIONS,
    allowlist: {
      regexes: [/example\.com/i, /placeholder/i, /noreply/i],
      paths: [],
      stopwords: ['example@example.com', 'user@example.com', 'noreply@anthropic.com']
    },
    testCases: [
      { input: 'contact: john.doe@gmail.com', shouldMatch: true },
      { input: 'no email here', shouldMatch: false },
      { input: 'noreply@example.com', shouldMatch: false }
    ]
  },
  {
    id: 'pii-phone-us',
    description: 'US phone number',
    category: 'pii',
    regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
    keywords: [],
    severity: 'MEDIUM',
    pathScope: 'non-code',
    pathScopeSkip: CODE_EXTENSIONS,
    allowlist: { regexes: [], paths: [], stopwords: ['555-555-5555', '000-000-0000', '123-456-7890'] },
    testCases: [
      { input: 'Call 555-123-4567', shouldMatch: true },
      { input: 'version 1.2.3', shouldMatch: false }
    ]
  },
  {
    id: 'pii-ssn',
    description: 'US Social Security Number',
    category: 'pii',
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
    keywords: ['-'],
    severity: 'CRITICAL',
    pathScope: 'all',
    allowlist: {
      regexes: [/000-00-0000/, /123-45-6789/, /xxx-xx-xxxx/i],
      paths: [],
      stopwords: ['000-00-0000', '123-45-6789']
    },
    testCases: [
      { input: 'SSN: 123-45-6789', shouldMatch: false },
      { input: 'SSN: 234-56-7890', shouldMatch: true },
      { input: 'not a ssn', shouldMatch: false }
    ]
  },
  {
    id: 'pii-credit-card',
    description: 'Credit card number (Visa, MC, Amex)',
    category: 'pii',
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/,
    keywords: [],
    severity: 'CRITICAL',
    pathScope: 'all',
    allowlist: {
      regexes: [/0000/, /1234/],
      paths: [],
      stopwords: ['4111111111111111', '5500000000000004']
    },
    testCases: [
      { input: 'card: 4111111111111111', shouldMatch: false },
      { input: 'card: 4532015112830366', shouldMatch: true },
      { input: 'not a card number', shouldMatch: false }
    ]
  },

  // === Privacy ===
  {
    id: 'privacy-windows-userpath',
    description: 'Windows user profile path',
    category: 'privacy',
    regex: /[A-Z]:[/\\]Users[/\\][^/\\\s<>{}"']+[/\\]/,
    keywords: ['Users'],
    severity: 'HIGH',
    allowlist: {
      regexes: [/<username>/i, /\$USER/i, /\{user\}/i, /YOUR_?NAME/i, /YourName/i, /example/i, /\[YOUR/i],
      paths: [],
      stopwords: []
    },
    testCases: [
      { input: 'C:/Users/Jacob/Desktop/project', shouldMatch: true },
      { input: 'C:/Users/<username>/Desktop/project', shouldMatch: false },
      { input: 'C:/Users/YourName/Desktop/project', shouldMatch: false },
      { input: 'no path here', shouldMatch: false }
    ]
  },
  {
    id: 'privacy-unix-homepath',
    description: 'Unix home directory path',
    category: 'privacy',
    regex: /\/home\/[a-zA-Z][a-zA-Z0-9_-]+\//,
    keywords: ['/home/'],
    severity: 'HIGH',
    allowlist: {
      regexes: [/<username>/i, /\$USER/i, /\{user\}/i, /example/i],
      paths: [],
      stopwords: []
    },
    testCases: [
      { input: '/home/jacob/.config/app', shouldMatch: true },
      { input: '/home/<username>/.config', shouldMatch: false },
      { input: 'no path', shouldMatch: false }
    ]
  },
  {
    id: 'privacy-mac-userpath',
    description: 'macOS user directory path',
    category: 'privacy',
    regex: /\/Users\/[a-zA-Z][a-zA-Z0-9_-]+\//,
    keywords: ['/Users/'],
    severity: 'HIGH',
    allowlist: {
      regexes: [/<username>/i, /\$USER/i, /\{user\}/i, /YOUR_?NAME/i, /YourName/i, /example/i, /Shared/],
      paths: [],
      stopwords: []
    },
    testCases: [
      { input: '/Users/jacob/Documents/project', shouldMatch: true },
      { input: '/Users/<username>/Documents', shouldMatch: false },
      { input: '/Users/YourName/Documents', shouldMatch: false },
      { input: '/Users/Shared/data', shouldMatch: false }
    ]
  },
  {
    id: 'privacy-local-ip',
    description: 'Private/local IP address',
    category: 'privacy',
    regex: /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
    keywords: ['192.168', '10.', '172.'],
    severity: 'LOW',
    allowlist: {
      regexes: [/example/i, /0\.0\.0\.0/, /placeholder/i],
      paths: [],
      stopwords: ['192.168.1.1', '10.0.0.1']
    },
    testCases: [
      { input: 'server at 192.168.1.100', shouldMatch: true },
      { input: 'public IP 8.8.8.8', shouldMatch: false }
    ]
  },
  {
    id: 'privacy-hostname',
    description: 'Windows machine hostname',
    category: 'privacy',
    regex: /\b(?:DESKTOP|LAPTOP|WORKSTATION)-[A-Z0-9]{5,}\b/,
    keywords: ['DESKTOP-', 'LAPTOP-', 'WORKSTATION-'],
    severity: 'MEDIUM',
    allowlist: {
      regexes: [/example/i, /XXXXX/],
      paths: [],
      stopwords: []
    },
    testCases: [
      { input: 'host: DESKTOP-ABC1234', shouldMatch: true },
      { input: 'just a string', shouldMatch: false }
    ]
  },
  {
    id: 'privacy-connection-string',
    description: 'Database connection string with credentials',
    category: 'privacy',
    regex: /(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqp):\/\/[^:]+:[^@]+@/,
    keywords: ['://'],
    severity: 'CRITICAL',
    allowlist: {
      regexes: [/localhost/i, /example\.com/i, /username:password/i],
      paths: [],
      stopwords: []
    },
    testCases: [
      { input: 'postgres://admin:secret@prod.db.com/mydb', shouldMatch: true },
      { input: 'postgres://username:password@example.com/db', shouldMatch: false },
      { input: 'https://example.com', shouldMatch: false }
    ]
  },

  // === Generic Secret (custom) ===
  {
    id: 'generic-api-key-custom',
    description: 'Generic API key (keyword + high entropy)',
    category: 'generic-secret',
    regex: /(?:api[_-]?key|api[_-]?secret|access[_-]?key|secret[_-]?key|auth[_-]?token|private[_-]?key|client[_-]?secret)[\s]*[=:][\s]*['"`]?([a-zA-Z0-9\/+=_-]{20,})/i,
    keywords: ['api_key', 'api-key', 'apikey', 'api_secret', 'apisecret', 'access_key', 'accesskey',
               'secret_key', 'secretkey', 'auth_token', 'authtoken', 'private_key', 'privatekey',
               'client_secret', 'clientsecret'],
    severity: 'HIGH',
    entropy: true,
    allowlist: {
      regexes: [/example/i, /placeholder/i, /your[_-]?api/i, /insert[_-]?your/i, /change[_-]?me/i, /TODO/],
      paths: [],
      stopwords: []
    },
    testCases: [
      { input: 'api_key = "sk_a8f3kd9x2mNpQ7rT1wZb4cE6gH8jK0l"', shouldMatch: true },
      { input: 'api_key = "test"', shouldMatch: false },
      { input: 'no secret here', shouldMatch: false }
    ]
  },
];

export { rules, categories, ENTROPY_THRESHOLD };