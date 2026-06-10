import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupHistoryComponent } from './backup-history.component';
import { BackupStore } from './backup-store.service';
import { BackupRecord, BffService } from '../bff.service';

describe('BackupHistoryComponent', () => {
  let fixture: ComponentFixture<BackupHistoryComponent>;
  let component: BackupHistoryComponent;
  let bff: jasmine.SpyObj<BffService>;

  const rows: BackupRecord[] = [
    {
      id: 'a1', created_at: '2026-06-10T00:00:00Z', requested_by: 'admin', scope: 'etcd',
      target: 'CLUSTER', encrypted: true, status: 'COMPLETED', size_bytes: 1048576, location_ref: 'cluster://a1',
    },
    {
      id: 'b2', created_at: '2026-06-10T01:00:00Z', requested_by: 'admin', scope: 'postgres',
      target: 'USB', encrypted: false, status: 'FAILED', size_bytes: null, error: 'pg_dump failed',
    },
  ];

  beforeEach(async () => {
    bff = jasmine.createSpyObj<BffService>('BffService', ['backupHistory', 'usbDevices']);
    bff.backupHistory.and.resolveTo(rows);
    bff.usbDevices.and.resolveTo([]);
    await TestBed.configureTestingModule({
      imports: [BackupHistoryComponent],
      providers: [BackupStore, { provide: BffService, useValue: bff }],
    }).compileComponents();
    fixture = TestBed.createComponent(BackupHistoryComponent);
    component = fixture.componentInstance;
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders a row per backup with status + encrypted columns', async () => {
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-backup="a1"]')).not.toBeNull();
    expect(el.querySelector('[data-backup="b2"]')).not.toBeNull();
    // status carries the TEXT label (not colour alone).
    expect(el.querySelector('[data-status="COMPLETED"]')!.textContent).toContain('COMPLETED');
    expect(el.querySelector('[data-status="FAILED"]')!.textContent).toContain('FAILED');
  });

  it('formats sizes and shows a dash when unknown', () => {
    expect(component.size(1048576)).toBe('1.0 MB');
    expect(component.size(512)).toBe('512 B');
    expect(component.size(null)).toBe('—');
  });

  it('maps statuses to colour-modifier classes paired with the text', () => {
    expect(component.statusClass('COMPLETED')).toBe('is-completed');
    expect(component.statusClass('FAILED')).toBe('is-failed');
    expect(component.statusClass('RUNNING')).toBe('is-running');
    expect(component.statusClass('QUEUED')).toBe('is-queued');
  });

  it('shows an empty-state row when there is no history', async () => {
    bff.backupHistory.and.resolveTo([]);
    await init();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="backup-history-empty"]')).not.toBeNull();
  });
});
