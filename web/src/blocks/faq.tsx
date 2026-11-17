import { m } from '@/paraglide/messages.js';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export function FAQ() {
  const items = [
    { q: m['tubitle.faq.1.q'](), a: m['tubitle.faq.1.a']() },
    { q: m['tubitle.faq.2.q'](), a: m['tubitle.faq.2.a']() },
    { q: m['tubitle.faq.3.q'](), a: m['tubitle.faq.3.a']() },
  ];
  return (
    <section className="tt-section tt-container tt-faq">
      <h2>{m['tubitle.faq.title']()}</h2>
      <Accordion>
        {items.map((item, i) => (
          <AccordionItem key={i} value={String(i)}>
            <AccordionTrigger className="py-5 text-left text-base">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground pb-5 leading-relaxed">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
