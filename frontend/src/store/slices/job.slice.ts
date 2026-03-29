import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface JobEntry {
  jobId: string;
  filename: string;
  submittedAt: string;
}

interface JobSliceState {
  activeJobs: JobEntry[];
}

const initialState: JobSliceState = {
  activeJobs: []
};

const jobSlice = createSlice({
  name: 'job',
  initialState,
  reducers: {
    addJob(state, action: PayloadAction<JobEntry>) {
      state.activeJobs.push(action.payload);
    },
    removeJob(state, action: PayloadAction<string>) {
      state.activeJobs = state.activeJobs.filter((j) => j.jobId !== action.payload);
    },
    clearJobs(state) {
      state.activeJobs = [];
    }
  }
});

export const { addJob, removeJob, clearJobs } = jobSlice.actions;
export default jobSlice.reducer;
