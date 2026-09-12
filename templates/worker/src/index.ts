import {
  createApp,
  FormBodyError,
  readFormDataWithinLimit,
  redirect,
} from 'workstar-app';
import { render as homeView } from '../.workstar/generated/views/home.js';
import { render as contactView } from '../.workstar/generated/views/contact.js';
import { render as thanksView } from '../.workstar/generated/views/thanks.js';

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
        stylesheets: ['/style.css', '/workstar.css'],
        content: homeView({}),
      }),
    },
    {
      name: 'contact',
      path: '/contact',
      page: () => ({
        lang: 'en',
        title: 'Contact',
        stylesheets: ['/style.css', '/workstar.css'],
        content: contactView({}),
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
        stylesheets: ['/style.css', '/workstar.css'],
        content: thanksView({}),
      }),
    },
  ],
});

export default {
  fetch(request, env) {
    return app.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;
