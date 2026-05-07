const core = require('@actions/core');
const axios = require('axios');
const InputValidator = require('./inputValidator');
const constants = require('../../config/constants');
const { BROWSERSTACK_INTEGRATIONS, ALLOWED_RERUN_ENV_VARS } = require("../../config/constants");

const {
  INPUT,
  ENV_VARS,
} = constants;

/**
 * ActionInput manages the fetching of action input values and
 * helps in setting env variables post validation.
 */
class ActionInput {
  constructor() {
    this._fetchAllInput();
    this._validateInput();
  }

  /**
   * Fetches all the input values given to the action.
   * Raises error if the required values are not provided.
   */
  _fetchAllInput() {
    try {
      // required fields
      this.username = core.getInput(INPUT.USERNAME, { required: true });
      this.accessKey = core.getInput(INPUT.ACCESS_KEY, { required: true });

      // non-compulsory fields
      this.buildName = core.getInput(INPUT.BUILD_NAME);
      this.projectName = core.getInput(INPUT.PROJECT_NAME);
      this.githubApp = core.getInput(INPUT.GITHUB_APP);
      this.githubToken = core.getInput(INPUT.GITHUB_TOKEN);
      this.rerunAttempt = process?.env?.GITHUB_RUN_ATTEMPT;
      this.runId = process?.env?.GITHUB_RUN_ID;
      this.repository = process?.env?.GITHUB_REPOSITORY;
    } catch (e) {
      throw Error(`Action input failed for reason: ${e.message}`);
    }
  }

  /**
   * Validates the input values
   */
  _validateInput() {
    this.username = InputValidator.updateUsername(this.username);
    this.buildName = InputValidator.validateBuildName(this.buildName);
    this.projectName = InputValidator.validateProjectName(this.projectName);
    this.githubApp = InputValidator.validateGithubAppName(this.githubApp);
    this.githubToken = InputValidator.validateGithubToken(this.githubToken);
  }

  /**
   * Sets env variables to be used in the test script for BrowserStack
   */
  async setEnvVariables() {
    core.startGroup('Setting Environment Variables');

    core.exportVariable(ENV_VARS.BROWSERSTACK_USERNAME, this.username);
    core.info(`Use ${ENV_VARS.BROWSERSTACK_USERNAME} environment variable for your username in your tests\n`);

    core.exportVariable(ENV_VARS.BROWSERSTACK_ACCESS_KEY, this.accessKey);
    core.info(`Use ${ENV_VARS.BROWSERSTACK_ACCESS_KEY} environment variable for your access key in your tests\n`);

    core.exportVariable(ENV_VARS.BROWSERSTACK_PROJECT_NAME, this.projectName);
    core.info(`${ENV_VARS.BROWSERSTACK_PROJECT_NAME} environment variable set as: ${this.projectName}`);
    core.info(`Use ${ENV_VARS.BROWSERSTACK_PROJECT_NAME} environment variable for your project name capability in your tests\n`);

    core.exportVariable(ENV_VARS.BROWSERSTACK_BUILD_NAME, this.buildName);
    core.info(`${ENV_VARS.BROWSERSTACK_BUILD_NAME} environment variable set as: ${this.buildName}`);
    core.info(`Use ${ENV_VARS.BROWSERSTACK_BUILD_NAME} environment variable for your build name capability in your tests\n`);

    if (await this.checkIfBStackReRun()) {
      await this.setBStackRerunEnvVars();
    }
    core.endGroup();
  }

  async checkIfBStackReRun() {
    // Ensure rerunAttempt is a number and greater than 1
    if (!this.rerunAttempt || Number(this.rerunAttempt) <= 1) {
      return false;
    }

    // Ensure runId, repository, username, and accessKey are valid
    if (!this.runId || !this.repository || this.repository === 'none'
      || !this.githubToken || this.githubToken === 'none' || !this.username || !this.accessKey) {
      return false;
    }

    const triggeringActor = process.env.GITHUB_TRIGGERING_ACTOR;
    core.info(`Triggering actor is - ${triggeringActor}`);
    return triggeringActor === this.githubApp;
  }

  async setBStackRerunEnvVars() {
    try {
      // Check if the run was triggered by the BrowserStack rerun bot
      core.info('The re-run was triggered by the GitHub App from BrowserStack.');

      const browserStackApiUrl = BROWSERSTACK_INTEGRATIONS.DETAILS_API_URL.replace('{runId}', this.runId);

      // Call BrowserStack API to get the tests to rerun
      const bsApiResponse = await axios.get(browserStackApiUrl, {
        auth: {
          username: this.username.replace("-GitHubAction", ""),
          password: this.accessKey,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const variables = bsApiResponse?.data?.data?.variables;
      if (variables && typeof variables === 'object') {
        // Security (APS-19076): only export env vars whose names are on the
        // allowlist. The BrowserStack rerun API response is treated as
        // attacker-influenced; without this filter, the API could inject
        // arbitrary env vars into the runner (e.g. NODE_OPTIONS, PATH,
        // GITHUB_TOKEN overrides) leading to RCE / token exfiltration.
        Object.keys(variables).forEach((key) => {
          if (ALLOWED_RERUN_ENV_VARS.includes(key)) {
            core.exportVariable(key, variables[key]);
          } else {
            core.warning(`Ignoring non-allowlisted env var from BrowserStack rerun API: ${key}`);
          }
        });
      }
    } catch (error) {
      core.info(`Error setting BrowserStack rerun environment variables: ${error.message}`);
    }
  }
}

module.exports = ActionInput;
