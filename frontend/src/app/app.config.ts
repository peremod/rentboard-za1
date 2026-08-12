import { ApplicationConfig, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withPreloading, PreloadAllModules } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { IMAGE_LOADER, ImageLoaderConfig } from '@angular/common';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { environment } from '@env/environment';

/**
 * Root application config — Angular 21, zoneless.
 * Auth interceptors wired in the 0.2.0 pass; IMAGE_LOADER wired in 0.4.0.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withPreloading(PreloadAllModules),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, errorInterceptor])),
    provideClientHydration(withEventReplay()),

    /**
     * NgOptimizedImage loader — maps a stored ImageKit file path + requested
     * width to a CDN URL. Local assets (starting with '/') pass through
     * untouched. This is what lets <img ngSrc="rooms/xyz.jpg"> automatically
     * get loading="lazy"/"eager", fetchpriority, and CLS-safe sizing.
     */
    {
      provide: IMAGE_LOADER,
      useValue: (config: ImageLoaderConfig) => {
        if (!config.src || config.src.startsWith('/')) return config.src;
        const w = config.width ?? 600;
        const variant = w <= 120 ? 'w-120,h-80' : w <= 600 ? 'w-600,h-400' : 'w-1200,h-800';
        return `${environment.imagekitUrl}/${config.src}?tr=${variant},c-maintain_ratio,q-80,f-auto`;
      },
    },
  ],
};
