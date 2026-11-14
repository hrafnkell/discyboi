import { api, ApiError, type Me } from '../store/account';
import type { SyncState, ThrowStore } from '../store/throws';
import { h } from './dom';

const SYNC_TEXT: Record<SyncState, string> = {
  local: 'Saved in this browser',
  synced: 'Saved to your account',
  pending: 'Saving…',
  offline: 'Server unreachable: changes are kept here and sent when it’s back',
  signedout: 'Signed out: sign in again to keep saving to your account',
};

/**
 * Sign-in button and account menu for the top bar. Signed out (or with no server), throws stay in
 * this browser; signed in, the store switches to the account's history on the server.
 */
export class AccountPanel {
  readonly el: HTMLElement;
  private btn: HTMLButtonElement;
  private pop: HTMLElement;
  private me?: Me;
  private reachable = false;

  constructor(
    private store: ThrowStore,
    private toast: (msg: string, kind?: 'err') => void,
  ) {
    this.btn = h('button.ghostbtn.acctbtn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.toggle() }, 'Sign in');
    this.pop = h('div.acctpop', { role: 'dialog', 'aria-label': 'Account', hidden: true });
    this.el = h('div.acct', {}, this.btn, this.pop);
    document.addEventListener('pointerdown', (e) => !this.el.contains(e.target as Node) && this.close());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());
    store.onSync = () => this.renderBtn();
    store.onAuthLost = () => {
      this.toast('Signed out of your account: new throws are saved in this browser', 'err');
      this.me = this.me && { ...this.me, user: null };
      store.useLocal();
      this.renderBtn();
    };
    this.renderBtn();
    void this.init();
  }

  private async init() {
    try {
      this.me = await api.me();
      this.reachable = true;
      if (this.me.user) await this.store.useAccount(this.me.user, this.me.maxThrows);
    } catch {
      this.reachable = false; // static hosting or server down: local history only
    }
    this.renderBtn();
  }

  private renderBtn() {
    const u = this.store.account;
    this.btn.classList.toggle('signedin', !!u);
    this.btn.dataset.sync = this.store.sync;
    this.btn.textContent = u ? u.username : 'Sign in';
    this.btn.title = u ? SYNC_TEXT[this.store.sync] : this.reachable ? 'Sign in to keep a longer throw history on the server' : 'No server: throws are saved in this browser';
    if (!this.pop.hidden) this.renderPop();
  }

  private toggle() {
    if (this.pop.hidden) {
      this.pop.hidden = false;
      this.btn.setAttribute('aria-expanded', 'true');
      this.renderPop();
      this.pop.querySelector<HTMLInputElement>('input')?.focus();
    } else this.close();
  }

  private close() {
    if (this.pop.hidden) return;
    this.pop.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
  }

  private renderPop() {
    this.pop.replaceChildren(this.store.account ? this.accountView() : this.signInView());
  }

  private signInView(): HTMLElement {
    if (!this.reachable)
      return h('div', {}, h('h3', {}, 'No server'), h('p.muted', {}, 'Accounts need the discyboi server (bun run server). Throws are saved in this browser, newest 500.'), h('button.ghostbtn', { type: 'button', onclick: () => this.init().then(() => this.renderPop()) }, 'Try again'));
    const signup = this.me?.signup ?? false;
    const user = h('input', { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 32, autocapitalize: 'none', spellcheck: 'false' });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 256 });
    const msg = h('p.acctmsg', { role: 'alert' });
    const submitBtn = h('button.connect', { type: 'submit' }, 'Sign in');
    const createBtn = signup ? h('button.ghostbtn', { type: 'submit', value: 'signup' }, 'Create account') : null;
    const form = h(
      'form.acctform',
      {},
      h('h3', {}, 'Your account'),
      h('p.muted', {}, `Signed out, throws are kept in this browser (newest 500). An account keeps up to ${(this.me?.maxThrows ?? 0).toLocaleString()} and shows them on every device.`),
      h('label', {}, 'Username', user),
      h('label', {}, 'Password', pass),
      msg,
      h('div.acctrow', {}, submitBtn, createBtn),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const creating = (e as SubmitEvent).submitter === createBtn;
      if (creating && pass.value.length < 8) {
        msg.textContent = 'Password: at least 8 characters';
        return;
      }
      for (const b of form.querySelectorAll('button')) b.disabled = true;
      msg.textContent = '';
      try {
        this.me = await (creating ? api.signup : api.login)(user.value.trim(), pass.value);
        await this.store.useAccount(this.me.user!, this.me.maxThrows);
        const local = this.store.localThrows().length;
        this.toast(creating ? `Account created. Welcome, ${this.me.user!.username}` : `Signed in as ${this.me.user!.username}`);
        if (local) this.toast(`${local} throws in this browser: upload them from the account menu`);
        this.close();
      } catch (err) {
        msg.textContent = err instanceof ApiError ? err.message : 'Something went wrong';
      } finally {
        for (const b of form.querySelectorAll('button')) b.disabled = false;
        this.renderBtn();
      }
    });
    return form;
  }

  private accountView(): HTMLElement {
    const u = this.store.account!;
    const local = this.store.localThrows().length;
    const n = this.store.all().length;
    const upload = h(
      'button.ghostbtn',
      {
        type: 'button',
        hidden: !local,
        title: 'Copies them; the browser copy stays for when you are signed out',
        onclick: async () => {
          upload.disabled = true;
          try {
            const added = await this.store.uploadLocal();
            this.toast(added ? `Uploaded ${added} throws` : 'Those throws are already in your account');
          } catch (err) {
            this.toast(`Upload failed: ${err instanceof Error ? err.message : err}`, 'err');
          } finally {
            upload.disabled = false;
          }
        },
      },
      `Upload ${local} throws from this browser`,
    );
    const out = h(
      'button.ghostbtn',
      {
        type: 'button',
        onclick: async () => {
          out.disabled = true;
          try {
            await api.logout();
          } catch {
            /* the cookie is cleared by the server; offline, the session just lapses */
          }
          this.store.useLocal();
          this.me = this.me && { ...this.me, user: null };
          this.toast('Signed out: showing the throws saved in this browser');
          this.close();
          this.renderBtn();
        },
      },
      'Sign out',
    );
    return h(
      'div',
      {},
      h('h3', {}, u.username),
      h('p', {}, h('span.syncdot', { 'data-sync': this.store.sync }), SYNC_TEXT[this.store.sync]),
      h('p.muted', {}, `${n.toLocaleString()} throws (up to ${this.store.capacity.toLocaleString()})`),
      h('div.acctrow', {}, upload, out),
    );
  }
}
