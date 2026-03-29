import { GraduationCap, BookOpen, Users } from 'lucide-react';
import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardHeader, CardTitle, CardDescription } from '@/ui/shadcn/ui/card';

const DETAILS = [
  {
    icon: GraduationCap,
    title: 'Institution',
    description: 'The College of Management \u2013 Academic Studies, Faculty of Computer Science'
  },
  {
    icon: BookOpen,
    title: 'Program',
    description: 'B.Sc. in Computer Science with Deep Learning Specialization'
  },
  {
    icon: Users,
    title: 'Supervisor',
    description: 'Dr. Moshe Butman'
  }
];

export function AcademicSection() {
  return (
    <section className="section-alt py-20 sm:py-24">
      <PageContainer>
        <SectionHeading
          title="Academic Context"
          subtitle="This project is developed as part of a final-year academic program."
        />
        <div className="grid gap-6 sm:grid-cols-3">
          {DETAILS.map((item) => (
            <Card key={item.title} className="text-center">
              <CardHeader>
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon className="size-5" />
                </div>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription className="text-sm">{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
