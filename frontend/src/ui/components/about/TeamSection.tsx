import { PageContainer } from '@/ui/components/PageContainer';
import { SectionHeading } from '@/ui/components/SectionHeading';
import { Card, CardHeader, CardTitle, CardDescription } from '@/ui/shadcn/ui/card';

const TEAM = [
  {
    name: 'Itay Aknin',
    initials: 'IA',
    role: 'Backend & Full-Stack Architecture Lead',
    bio: 'Responsible for backend architecture, full-stack development, and end-to-end system integration.'
  },
  {
    name: 'Moriel Turgeman',
    initials: 'MT',
    role: 'AI & Deep Learning Architecture Lead',
    bio: 'Leads model architecture design, deep learning experimentation, baseline CNN implementation, and training strategy.'
  },
  {
    name: 'Roi Forer',
    initials: 'RF',
    role: 'Data & Evaluation Lead',
    bio: 'Manages dataset preparation, synthetic degradation pipeline, and quantitative evaluation of model performance.'
  }
];

export function TeamSection() {
  return (
    <section className="py-20 sm:py-24">
      <PageContainer>
        <SectionHeading
          title="Meet the Team"
          subtitle="Three computer science students passionate about deep learning and video restoration."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map((member) => (
            <Card key={member.name} className="text-center">
              <CardHeader>
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                  {member.initials}
                </div>
                <CardTitle className="text-base">{member.name}</CardTitle>
                <p className="text-sm font-medium text-primary">{member.role}</p>
                <CardDescription className="mt-2 text-sm leading-relaxed">
                  {member.bio}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
