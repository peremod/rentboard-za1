import { bootstrapApplication } from '@angular/platform-browser';
import type { BootstrapContext } from '@angular/platform-browser';
import { config } from './app/app.config.server';
import { App } from './app/app';

/**
 * Server-side bootstrap entry point.
 *
 * Angular 21 requires the BootstrapContext supplied by the SSR runtime to be
 * forwarded to bootstrapApplication — without it the platform is never
 * created and SSR fails with NG0401 (Missing Platform).
 */
const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
