import { html } from 'workstar';
import {
  createApp,
  FormBodyError,
  readFormDataWithinLimit,
  redirect,
} from 'workstar-app';

const app = createApp<Env>({
  routes: [
    {
      name: 'home',
      path: '/',
      page: () => ({
        lang: 'en',
        title: 'Workstar Worker starter',
        description:
          'An accessible, server-rendered Workstar page on Cloudflare Workers.',
        stylesheets: ['/style.css'],
        content: html`<main>
          <h1>Ready to build.</h1>
          <p>
            This page is rendered on the server and works without JavaScript.
          </p>
          <a href="/contact">Contact us</a>
        </main>`,
      }),
    },
    {
      name: 'contact',
      path: '/contact',
      page: () => ({
        lang: 'en',
        title: 'Contact',
        stylesheets: ['/style.css'],
        content: html`<main>
          <h1>Contact</h1>
          <form method="post">
            <label
              >Your name <input name="name" required maxlength="80" /></label
            ><button type="submit">Send</button>
          </form>
        </main>`,
      }),
      action: async ({ request }) => {
        let form: FormData;
        try {
          form = await readFormDataWithinLimit(request, 8 * 1024);
        } catch (error) {
          if (error instanceof FormBodyError) {
            return new Response(error.message, { status: error.status });
          }
          throw error;
        }
        const name = form.get('name');
        if (typeof name !== 'string' || !name.trim() || name.length > 80) {
          return new Response('Enter a name of at most 80 characters.', {
            status: 400,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }
        // This is a routing example, not a mail integration.
        return redirect('/thanks');
      },
    },
    {
      name: 'thanks',
      path: '/thanks',
      page: () => ({
        lang: 'en',
        title: 'Thank you',
        stylesheets: ['/style.css'],
        content: html`<main>
          <h1>Thank you.</h1>
          <a href="/">Back to home</a>
        </main>`,
      }),
    },
  ],
});

export default {
  fetch(request, env) {
    return app.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;
