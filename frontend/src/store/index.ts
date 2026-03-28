import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';

import { upscaleApi } from '@/store/api/upscale.api';

export const store = configureStore({
  reducer: {
    [upscaleApi.reducerPath]: upscaleApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(upscaleApi.middleware)
});

setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
