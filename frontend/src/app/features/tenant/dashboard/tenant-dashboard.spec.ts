import { describe, it, expect } from 'vitest';
import { TenantDashboard } from './tenant-dashboard';

/**
 * Which applications count as still open on the tenant's dashboard.
 *
 * Reported from a phone with both screens side by side: the landlord's
 * applicants screen showed "Tk — SHORTLISTED" with Accept and Reject, and the
 * tenant's dashboard said "None of your applications are still open". The two
 * screens were answering different questions — the landlord's reads the
 * APPLICATION's status, this read the TENANCY's — and they only disagree once
 * something puts a decided application back into a live state.
 *
 * The method is exercised directly rather than through TestBed: it reads
 * nothing but `applications()` and its own `tenancyHasMovedOn`, so a rendered
 * component would add a page of setup and test the same two lines.
 */
describe('TenantDashboard — what counts as still open', () => {
  const dash = Object.create(TenantDashboard.prototype) as {
    applications: () => unknown[];
    activeApplications: () => { id: string }[];
  };

  const run = (rows: Record<string, unknown>[]) => {
    dash.applications = () => rows;
    return dash.activeApplications().map((a) => a.id);
  };

  const app = (over: Record<string, unknown> = {}) => ({
    id: 'a1', status: 'pending', isArchived: false, tenancy: null, ...over,
  });

  it('counts an application waiting on a landlord decision', () => {
    expect(run([app({ status: 'pending' })])).toEqual(['a1']);
    expect(run([app({ status: 'viewed' })])).toEqual(['a1']);
    expect(run([app({ status: 'shortlisted' })])).toEqual(['a1']);
  });

  it('still counts one when a PAST letting of the same room has ended', () => {
    /**
     * 🔴 The reported bug. The tenant was accepted, moved in, the tenancy
     * ended, and the application was later back to `shortlisted`. The tenancy
     * clause applied to every status, so this row fell through every section
     * of the dashboard — `closedApplications` wants archived/withdrawn/
     * rejected and `availableAgain` wants archived — and appeared nowhere,
     * while the landlord was waiting on a decision.
     */
    expect(run([app({ status: 'shortlisted', tenancy: { status: 'ended' } })])).toEqual(['a1']);
    expect(run([app({ status: 'shortlisted', tenancy: { status: 'cancelled' } })])).toEqual(['a1']);
    expect(run([app({ status: 'pending', tenancy: { status: 'ended' } })])).toEqual(['a1']);
  });

  it('does not count a letting that has moved past being an application', () => {
    // Phase D, and still right: an acceptance whose tenancy is live or
    // finished is not something the tenant is waiting on a landlord for.
    expect(run([app({ status: 'accepted', tenancy: { status: 'active' } })])).toEqual([]);
    expect(run([app({ status: 'accepted', tenancy: { status: 'ended' } })])).toEqual([]);
    expect(run([app({ status: 'accepted', tenancy: { status: 'cancelled' } })])).toEqual([]);
  });

  it('counts an acceptance whose move-in nobody has confirmed yet', () => {
    expect(run([app({ status: 'accepted', tenancy: { status: 'pending' } })])).toEqual(['a1']);
    expect(run([app({ status: 'accepted', tenancy: null })])).toEqual(['a1']);
  });

  it('never counts an archived, withdrawn or rejected application', () => {
    expect(run([app({ isArchived: true })])).toEqual([]);
    expect(run([app({ status: 'withdrawn' })])).toEqual([]);
    expect(run([app({ status: 'rejected' })])).toEqual([]);
    // Archived wins even when the status still looks live.
    expect(run([app({ status: 'shortlisted', isArchived: true })])).toEqual([]);
  });
});
