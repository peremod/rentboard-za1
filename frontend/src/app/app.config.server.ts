import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes';

/**
 * Server-only additions to appConfig. Without provideServerRendering(withRoutes(...)),
 * the SSR build falls back to crawling the client Router for static paths — it silently
 * skips any route that needs a param, including the whole ':lang' locale tree, since
 * getPrerenderParams is only read from this config.
 */
const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
