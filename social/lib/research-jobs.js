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

function buildResearchJob({ topicThesis, submitted, mode }) {
  return {
    id: sha256(`${topicThesis}:${submitted.interaction_id}`).slice(0, 12),
    topic_thesis: topicThesis,
    interaction_id: submitted.interaction_id,
    status: submitted.status,
    submitted_at: submitted.submitted_at,
    mode,
    watchlist_inputs: submitted.watchlist_inputs,
  };
}

function findPendingJobForTopic(topicThesis) {
  const state = loadResearchJobs();
  return (state.jobs || []).find((job) => job.topic_thesis === topicThesis) || null;
}

module.exports = {
  loadResearchJobs,
  saveResearchJobs,
  upsertResearchJob,
  removeResearchJob,
  buildResearchJob,
  findPendingJobForTopic,
};

