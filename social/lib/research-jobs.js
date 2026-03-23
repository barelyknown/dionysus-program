const { readJson, writeJson } = require('./fs');
const { paths } = require('./paths');
const { sha256 } = require('./hash');

function loadResearchJobs() {
  return readJson(paths.researchJobsFile, { jobs: [] }) || { jobs: [] };
}

function saveResearchJobs(state) {
  writeJson(paths.researchJobsFile, state);
}

function upsertResearchJob(job) {
  const state = loadResearchJobs();
  const jobs = (state.jobs || []).filter((entry) => entry.id !== job.id);
  jobs.push(job);
  saveResearchJobs({ jobs });
  return job;
}

function removeResearchJob(jobId) {
  const state = loadResearchJobs();
  saveResearchJobs({ jobs: (state.jobs || []).filter((entry) => entry.id !== jobId) });
}

function buildResearchJob({ topicThesis = null, jobKey = null, submitted, mode }) {
  const resolvedJobKey = jobKey || submitted.job_key || topicThesis || submitted.topic_thesis || submitted.interaction_id;
  return {
    id: sha256(`${resolvedJobKey}:${submitted.interaction_id}`).slice(0, 12),
    job_key: resolvedJobKey,
    topic_thesis: topicThesis || submitted.topic_thesis || null,
    interaction_id: submitted.interaction_id,
    status: submitted.status,
    submitted_at: submitted.submitted_at,
    mode,
    watchlist_inputs: submitted.watchlist_inputs,
    topic_options: submitted.topic_options || [],
    discovery_mode: submitted.discovery_mode || null,
  };
}

function findPendingJob(jobKey) {
  if (!jobKey) return null;
  const state = loadResearchJobs();
  return (state.jobs || []).find((job) => (job.job_key || job.topic_thesis) === jobKey) || null;
}

function findPendingJobForTopic(topicThesis) {
  return findPendingJob(topicThesis);
}

module.exports = {
  loadResearchJobs,
  saveResearchJobs,
  upsertResearchJob,
  removeResearchJob,
  buildResearchJob,
  findPendingJob,
  findPendingJobForTopic,
};
