import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F='/usr/share/fonts/truetype/crosextra/'
pdfmetrics.registerFont(TTFont('B',F+'Carlito-Regular.ttf')); pdfmetrics.registerFont(TTFont('B-B',F+'Carlito-Bold.ttf')); pdfmetrics.registerFont(TTFont('B-I',F+'Carlito-Italic.ttf'))
pdfmetrics.registerFontFamily('B',normal='B',bold='B-B',italic='B-I',boldItalic='B-B')
NAME="Diadie Diawara"
CONTACT = sys.argv[1] if len(sys.argv)>1 else "[VOTRE NUMÉRO WHATSAPP]"
NAVY=colors.HexColor('#0C2340'); BLUE=colors.HexColor('#17569F'); PALE=colors.HexColor('#EAF1F9'); GREY=colors.HexColor('#52627A'); LINE=colors.HexColor('#C5D2E0'); GOLD=colors.HexColor('#F0B323'); GREEN=colors.HexColor('#167F42')
W,H=A4
body=ParagraphStyle('b',fontName='B',fontSize=10,leading=13.2,textColor=NAVY)
cell=ParagraphStyle('c',parent=body,fontSize=9.4,leading=12.2)
small=ParagraphStyle('s',parent=body,fontSize=8.6,leading=11.4,textColor=GREY)
h2=ParagraphStyle('h2',parent=body,fontName='B-B',fontSize=12.5,leading=15.5,spaceBefore=3,spaceAfter=4)
ct=ParagraphStyle('ct',parent=body,fontName='B-B',fontSize=11.4,leading=13.6)
price=ParagraphStyle('pr',parent=body,fontName='B-B',fontSize=14,leading=16,textColor=BLUE,alignment=TA_RIGHT)
price_s=ParagraphStyle('ps',parent=small,alignment=TA_RIGHT)

# prix communs (F CFA) : site 50 000, assistant IA 60 000, présence 25 000, suivi 35 000, docs/formation 30 000
S = {
'sante': dict(
  file='offre-sante.pdf', titre='Cliniques et cabinets médicaux', accroche='Moins d\'appels manqués, plus de rendez-vous, des patients mieux informés',
  enjeux=["Les patients cherchent d'abord sur leur téléphone : horaires, spécialités, tarifs, itinéraire.",
          "Un appel manqué ou un message sans réponse est un rendez-vous qui part ailleurs.",
          "Les rendez-vous oubliés et le suivi sur papier font perdre du temps au personnel."],
  sols=[("Site de la clinique + rendez-vous WhatsApp",50000,"Spécialités, équipe, horaires, accès, et un bouton pour prendre rendez-vous sur WhatsApp.","les patients vous trouvent et vous contactent en un clic."),
        ("Assistant IA d'accueil 24 h/24",60000,"Répond aux questions fréquentes (horaires, spécialités, démarches), recueille le motif et les coordonnées du patient.","aucune demande perdue la nuit ou aux heures chargées."),
        ("Rappels de rendez-vous automatiques",35000,"Message WhatsApp ou SMS la veille de chaque rendez-vous, avec possibilité de confirmer ou de reporter.","moins de rendez-vous manqués et un planning plus rempli."),
        ("Fiche Google et avis patients",25000,"Fiche Google Maps complète et exacte, affiche à QR code en salle d'attente pour recueillir les avis.","une meilleure image et plus de nouveaux patients."),
        ("Planning et suivi des patients",40000,"Tableau partagé des rendez-vous, des relances de suivi et des statistiques simples de fréquentation.","un cabinet mieux organisé, sans perte de dossier."),
        ("Supports d'information santé",20000,"Affiches, brochures et publications de prévention aux couleurs de votre établissement.","des patients informés et une image sérieuse.")],
  packs=[("Pack Visibilité","Site + fiche Google",(0,3)),("Pack Accueil","Site + assistant IA + rappels de rendez-vous",(0,1,2)),("Pack Clinique complète","Site, assistant IA, rappels, avis et planning",(0,1,2,3,4))],
  audit=dict(titre="Audit du parcours patient", sous="De la recherche sur Google jusqu'au rendez-vous honoré",
    pts=["Trouve-t-on votre clinique sur Google Maps avec les bonnes horaires et le bon numéro ?","Un appel ou un message WhatsApp reçoit-il une réponse rapide, y compris le soir ?","Les spécialités, tarifs indicatifs et l'accès sont-ils visibles en ligne ?","Comment un patient prend-il rendez-vous, en combien d'étapes ?","Un rappel est-il envoyé avant le rendez-vous ?","Les patients satisfaits sont-ils invités à laisser un avis ?"],
    liv="Un rapport d'une page avec les points faibles classés par priorité et un plan d'action chiffré.")),
'hotel': dict(
  file='offre-hotel-restaurant.pdf', titre='Hôtels et restaurants', accroche='Plus de réservations directes, moins de dépendance aux plateformes',
  enjeux=["Les clients comparent photos, prix et avis avant de réserver, souvent depuis leur téléphone.",
          "Les réservations passées par des intermédiaires coûtent des commissions.",
          "Sans fichier clients, il est difficile de faire revenir les clients fidèles."],
  sols=[("Site avec chambres ou menu + réservation WhatsApp",50000,"Photos, tarifs, services, localisation et un bouton « Réserver sur WhatsApp ».","des réservations directes, sans commission."),
        ("Assistant IA de réservation (français et anglais)",60000,"Répond sur les disponibilités, les tarifs, le menu et l'accès, et recueille les demandes de réservation.","des clients servis même quand la réception est occupée."),
        ("Menu digital à QR code + commandes WhatsApp",30000,"Menu à jour consultable sur téléphone, avec prise de commande ou de réservation de table par WhatsApp.","un service plus rapide et un menu toujours à jour."),
        ("Fiche Google et collecte d'avis",25000,"Fiche Google Maps soignée, photos, réponses aux avis, QR code pour inviter les clients à noter.","plus de visibilité et de confiance."),
        ("Visuels et promotions réseaux sociaux",25000,"Pack de 12 visuels (plats du jour, offres, événements) prêts à publier.","une page active qui attire de nouveaux clients."),
        ("Fichier clients et offres de fidélité",35000,"Liste de vos clients, messages WhatsApp d'anniversaire ou d'offre spéciale, suivi des habitués.","des clients qui reviennent, sans publicité coûteuse.")],
  packs=[("Pack Visibilité","Site + fiche Google + visuels",(0,3,4)),("Pack Réservation","Site, assistant IA et menu digital",(0,1,2)),("Pack Établissement complet","Site, assistant IA, menu, avis, visuels et fidélité",(0,1,2,3,4,5))],
  audit=dict(titre="Audit de l'expérience de réservation", sous="Du premier clic jusqu'au retour du client",
    pts=["Votre établissement apparaît-il sur Google Maps avec des photos récentes ?","Les prix et le menu sont-ils visibles sans devoir appeler ?","Réserver demande-t-il plus de deux messages ?","Répondez-vous aux avis, positifs comme négatifs ?","Un client étranger trouve-t-il l'information en anglais ?","Gardez-vous les coordonnées des clients pour les faire revenir ?"],
    liv="Un rapport d'une page avec les points faibles classés par priorité et un plan d'action chiffré.")),
'ecole': dict(
  file='offre-ecole-institut.pdf', titre='Écoles et instituts', accroche='Plus d\'inscriptions, des parents mieux informés, une administration allégée',
  enjeux=["Parents et étudiants comparent les établissements en ligne avant de se déplacer.",
          "Les mêmes questions (frais, filières, dates) occupent le secrétariat toute la journée.",
          "Les rappels de paiement et les annonces aux parents prennent beaucoup de temps."],
  sols=[("Site de l'établissement + inscription en ligne",50000,"Filières, frais, calendrier, équipe pédagogique et formulaire de pré-inscription.","des dossiers reçus même hors des heures d'ouverture."),
        ("Assistant IA pour parents et futurs étudiants",60000,"Répond sur les filières, les frais, les dates de rentrée et les pièces à fournir, 24 h/24.","un secrétariat soulagé et des familles rassurées."),
        ("Portail d'inscriptions et de dossiers",45000,"Dépôt des pièces, suivi de chaque dossier, relances automatiques des dossiers incomplets.","moins de papier et aucune inscription perdue."),
        ("Communication parents par WhatsApp",30000,"Annonces, convocations, résultats et rappels de paiement envoyés à tous les parents en quelques clics.","des parents informés, et des frais payés plus à temps."),
        ("Supports de promotion de la rentrée",25000,"Brochure, affiches et visuels pour les réseaux sociaux aux couleurs de l'établissement.","une campagne d'inscription visible et professionnelle."),
        ("Formation IA des enseignants",30000,"Séance pratique de 2 heures : préparer des cours, des exercices et des évaluations avec l'IA.","des enseignants qui gagnent du temps de préparation.")],
  packs=[("Pack Inscriptions","Site + assistant IA",(0,1)),("Pack Rentrée","Site, assistant IA et supports de promotion",(0,1,4)),("Pack Établissement complet","Site, assistant IA, portail, parents et promotion",(0,1,2,3,4))],
  audit=dict(titre="Audit du parcours d'inscription", sous="Du moment où un parent cherche une école jusqu'au premier paiement",
    pts=["L'établissement est-il facile à trouver sur Google et sur les réseaux sociaux ?","Les filières et les frais sont-ils visibles sans devoir se déplacer ?","Combien de temps faut-il pour répondre à une demande d'information ?","Un dossier peut-il être déposé sans venir sur place ?","Les dossiers incomplets sont-ils relancés ?","Les parents reçoivent-ils les annonces et rappels de façon organisée ?"],
    liv="Un rapport d'une page avec les points faibles classés par priorité et un plan d'action chiffré.")),
'conseil': dict(
  file='offre-conseil-formation.pdf', titre='Cabinets de conseil et de formation', accroche='Plus de clients qualifiés, des dossiers mieux suivis, des livrables plus rapides',
  enjeux=["Une entreprise juge un cabinet sur sa présence en ligne avant même le premier appel.",
          "Les demandes arrivent par téléphone, WhatsApp et e-mail, et certaines se perdent.",
          "Rédiger propositions, rapports et supports de formation prend un temps précieux."],
  sols=[("Site professionnel + prise de rendez-vous",50000,"Services, références, équipe, domaines d'intervention et bouton de rendez-vous WhatsApp.","une crédibilité immédiate auprès des entreprises."),
        ("Assistant IA de qualification des demandes",60000,"Pose les bonnes questions (besoin, secteur, délai) et vous transmet des demandes déjà qualifiées.","vous rappelez les bons prospects en premier."),
        ("Catalogue de formations avec inscription en ligne",50000,"Page de chaque formation (programme, durée, tarif), formulaire d'inscription et suivi des inscrits.","des sessions remplies plus facilement."),
        ("Suivi clients et relances",35000,"Tableau de suivi des prospects et dossiers, rappels de rendez-vous, relances automatiques.","aucun prospect oublié, un cycle de vente suivi."),
        ("Propositions et rapports assistés par IA",30000,"Modèles de propositions, rapports et supports rédigés plus vite, plus formation pratique de l'équipe.","des livrables plus rapides à qualité égale."),
        ("Présence LinkedIn et Facebook",25000,"Pages professionnelles, visuels, et une série de publications expertes prêtes à publier.","une image d'expert dans votre domaine.")],
  packs=[("Pack Crédibilité","Site + présence LinkedIn et Facebook",(0,5)),("Pack Prospection","Site, assistant IA et suivi clients",(0,1,3)),("Pack Cabinet complet","Site, assistant IA, formations, suivi et documents IA",(0,1,2,3,4))],
  audit=dict(titre="Audit de la génération de clients", sous="Comment un prospect vous trouve, vous contacte et devient client",
    pts=["Un prospect qui tape votre nom trouve-t-il un site et des références ?","Sous quel délai répondez-vous à une demande reçue sur WhatsApp ?","En combien de temps un devis ou une proposition est-il envoyé ?","Chaque prospect est-il noté quelque part, avec une date de relance ?","Vos références et témoignages sont-ils visibles ?","Quelle part du temps est passée à rédiger des documents répétitifs ?"],
    liv="Un rapport d'une page avec les points faibles classés par priorité et un plan d'action chiffré.")),
'btp': dict(
  file='offre-btp-commerce.pdf', titre='BTP et commerce', accroche='Plus de devis demandés, des chantiers mieux suivis, des clients rassurés',
  enjeux=["Un client qui veut construire cherche des preuves : réalisations, photos, coordonnées sérieuses.",
          "Les demandes de devis arrivent de partout, et le temps de réponse décide souvent de qui est choisi.",
          "Le client veut voir l'avancement de son chantier, surtout s'il vit à l'étranger."],
  sols=[("Site vitrine + devis par WhatsApp",50000,"Services, présentation, réalisations et formulaire de devis qui arrive sur votre WhatsApp.","des demandes qualifiées, directement chez vous."),
        ("Assistant IA de pré-qualification",60000,"Recueille le type de projet, la surface, le quartier et le budget avant que vous ne rappeliez.","vous ne perdez plus de temps avec les demandes floues."),
        ("Portfolio de chantiers et vidéos courtes",30000,"Page de réalisations avec photos avant/après et vidéos courtes pour vos réseaux sociaux.","la preuve visible de votre savoir-faire."),
        ("Devis et factures professionnels",35000,"Modèles de devis et de factures avec calcul automatique, aux couleurs de l'entreprise.","des devis envoyés plus vite et sans erreur de calcul."),
        ("Suivi de chantier partagé",35000,"Point d'avancement avec photos datées envoyé au client sur WhatsApp, à chaque étape.","un client rassuré, même à distance."),
        ("Fiche Google et identité visuelle",25000,"Fiche Google Maps, logo, cartes de visite et affiches de chantier.","une image sérieuse sur le terrain comme en ligne.")],
  packs=[("Pack Crédibilité","Site + portfolio + fiche Google",(0,2,5)),("Pack Devis","Site, assistant IA et devis professionnels",(0,1,3)),("Pack Entreprise complète","Site, assistant IA, portfolio, devis et suivi de chantier",(0,1,2,3,4))],
  audit=dict(titre="Audit de la chaîne devis → chantier", sous="De la demande du client jusqu'à la remise des clés",
    pts=["Un client trouve-t-il facilement vos réalisations avant d'appeler ?","Sous quel délai répondez-vous à une demande de devis ?","Vos devis sont-ils détaillés poste par poste, avec une présentation soignée ?","Le client reçoit-il des nouvelles régulières pendant le chantier ?","Gardez-vous des photos datées de chaque étape ?","Demandez-vous un avis ou une recommandation à la fin du chantier ?"],
    liv="Un rapport d'une page avec les points faibles classés par priorité et un plan d'action chiffré.")),
'immo': dict(
  file='offre-immobilier-transport.pdf', titre='Immobilier et transport', accroche='Des annonces qui se voient, des demandes qui se transforment en visites ou en réservations',
  enjeux=["Les clients regardent les annonces sur téléphone : photos, prix et quartier doivent se voir tout de suite.",
          "Chaque demande non rappelée est une visite ou une réservation perdue.",
          "Sans suivi, les prospects de la semaine dernière sont déjà oubliés."],
  sols=[("Site catalogue + contact WhatsApp",50000,"Biens ou trajets avec photos, prix, quartier, filtres simples et bouton WhatsApp sur chaque fiche.","des clients qui vous contactent en un clic."),
        ("Assistant IA de réponse aux demandes",60000,"Répond sur le budget, le quartier, la disponibilité ou les horaires, et recueille les coordonnées.","des réponses immédiates, même hors horaires."),
        ("Annonces visuelles professionnelles",30000,"Modèles de fiches, photos retouchées et vidéos courtes de présentation des biens ou des véhicules.","des annonces qui se démarquent."),
        ("Suivi des prospects et des visites",35000,"Tableau des prospects, visites programmées, rappels de rendez-vous et relances automatiques.","chaque demande est suivie jusqu'à la décision."),
        ("Demande de visite ou réservation en ligne",40000,"Formulaire de demande de visite ou de réservation de place, avec confirmation par WhatsApp.","moins d'appels pour fixer un rendez-vous."),
        ("Fiche Google et réseaux sociaux",25000,"Fiche Google Maps, page Facebook et publications régulières de vos offres.","plus de visibilité auprès des clients de votre quartier.")],
  packs=[("Pack Visibilité","Site + annonces visuelles + fiche Google",(0,2,5)),("Pack Conversion","Site, assistant IA et suivi des prospects",(0,1,3)),("Pack Agence complète","Site, assistant IA, annonces, suivi et demandes en ligne",(0,1,2,3,4))],
  audit=dict(titre="Audit du parcours client", sous="De l'annonce jusqu'à la visite ou à la réservation",
    pts=["Vos annonces sont-elles visibles en ligne avec photos, prix et quartier ?","Sous quel délai répondez-vous à une demande reçue sur WhatsApp ?","Un client peut-il demander une visite ou réserver sans appeler ?","Chaque prospect est-il noté avec une date de relance ?","Vos photos et vidéos donnent-elles envie de se déplacer ?","Votre fiche Google est-elle complète et à jour ?"],
    liv="Un rapport d'une page avec les points faibles classés par priorité et un plan d'action chiffré.")),
}

def fm(n): return f"{n:,}".replace(',', ' ')+" F"
def rnd5(x): return int(round(x/5000.0)*5000)

def build(key):
    d=S[key]; OUT=d['file']
    def cover(c,doc):
        c.saveState(); c.setFillColor(NAVY); c.rect(0,H-46*mm,W,46*mm,stroke=0,fill=1); c.setFillColor(GOLD); c.rect(0,H-46*mm,W,1.6*mm,stroke=0,fill=1)
        c.setFillColor(colors.HexColor('#F0B323')); c.setFont('B-B',9.5); c.drawString(20*mm,H-14*mm,"SOLUTIONS DIGITALES  ·  "+d['titre'].upper())
        c.setFillColor(colors.white); c.setFont('B-B',21)
        c.drawString(20*mm,H-26*mm,"Faites de votre téléphone un outil de croissance" if False else d['titre'])
        c.setFont('B',11.5); c.setFillColor(colors.HexColor('#BBD2EE')); c.drawString(20*mm,H-34.5*mm,d['accroche'])
        c.setFont('B',9); c.drawString(20*mm,H-41*mm,f"Proposition de {NAME}  ·  Bamako, 30 octobre 2026")
        foot(c,doc); c.restoreState()
    def later(c,doc):
        c.saveState(); c.setFillColor(NAVY); c.rect(0,H-13*mm,W,13*mm,stroke=0,fill=1); c.setFillColor(GOLD); c.rect(0,H-13*mm,W,1*mm,stroke=0,fill=1)
        c.setFillColor(colors.white); c.setFont('B-B',10.5); c.drawString(20*mm,H-8.6*mm,"Solutions digitales  ·  "+d['titre']); foot(c,doc); c.restoreState()
    def foot(c,doc):
        c.setFont('B',8.5); c.setFillColor(GREY); c.drawString(20*mm,9*mm,f"{NAME}  ·  WhatsApp : {CONTACT}"); c.drawRightString(W-20*mm,9*mm,f"Page {doc.page}")

    def card(n,t,p,what,res):
        left=[Paragraph(f"<font color='#17569F'>{n}.</font> {t}",ct),Spacer(1,2),Paragraph(what,cell),Spacer(1,1.5),Paragraph(f"<b>Pour vous :</b> {res}",cell)]
        right=[Paragraph("à partir de",price_s),Paragraph(fm(p),price)]
        tb=Table([[left,right]],colWidths=[130*mm,40*mm])
        tb.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),0.7,LINE),('LINEBEFORE',(0,0),(0,-1),3,BLUE),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),5.5),('BOTTOMPADDING',(0,0),(-1,-1),6.5)]))
        return [KeepTogether([tb]),Spacer(1,4.5)]

    st=[Paragraph("Ce que nous voyons dans votre secteur",h2)]
    box=Table([[Paragraph("<br/>".join("• "+e for e in d['enjeux']),cell)]],colWidths=[170*mm])
    box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    st+=[box,Spacer(1,7),Paragraph("Six solutions pour votre activité",h2)]
    for i,(t,p,w,r) in enumerate(d['sols'],1): st+=card(i,t,p,w,r)

    # page 2 : packs
    st.append(Paragraph("Offres groupées",h2))
    rows=[]
    for name,desc,idx in d['packs']:
        total=sum(d['sols'][i][1] for i in idx); pk=rnd5(total*0.88)
        rows.append([Paragraph(f"<b>{name}</b><br/>{desc}",cell),Paragraph(f"<font size=8 color='#52627A'><strike>{fm(total)}</strike></font><br/><b>{fm(pk)}</b>",ParagraphStyle('pk',parent=cell,fontSize=12,textColor=BLUE,alignment=TA_RIGHT,leading=14))])
    pt=Table(rows,colWidths=[130*mm,40*mm]); pt.setStyle(TableStyle([('BOX',(0,0),(-1,-1),0.7,LINE),('LINEBELOW',(0,0),(-1,-2),0.5,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    st+=[pt,Spacer(1,8)]

    # offres irrésistibles
    ir=[("Audit express offert","Avec tout pack commandé, l'audit ci-dessous (valeur 15 000 F) vous est offert."),
        ("Prototype gratuit","Vous voyez le résultat avant de payer quoi que ce soit."),
        ("Paiement en deux temps","La moitié à la commande, la moitié à la livraison."),
        ("Satisfait ou solde non dû","Si le résultat final ne vous convient pas après les modifications, vous ne payez pas le solde."),
        ("Un mois de support offert","Modifications mineures et aide sur WhatsApp pendant 30 jours après la livraison.")]
    cells=[[Paragraph(f"<b>{a}</b><br/>{b}",cell)] for a,b in ir]
    it=Table([[Paragraph("<font color='white'><b>Cinq avantages inclus avec toute commande</b></font>",ParagraphStyle('wh',parent=cell,fontSize=10.8,textColor=colors.white))]]+cells,colWidths=[170*mm])
    it.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),GREEN),('BOX',(0,0),(-1,-1),0.7,GREEN),('LINEBELOW',(0,1),(-1,-2),0.4,LINE),('LEFTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),4.5),('BOTTOMPADDING',(0,0),(-1,-1),5.5)]))
    st+=[KeepTogether([it]),Spacer(1,9)]

    # audit
    a=d['audit']
    arows=[[Paragraph(f"<font color='white'><b>Cas d'audit : {a['titre']}</b></font><br/><font color='#BBD2EE' size=9>{a['sous']}</font>",ParagraphStyle('ah',parent=cell,fontSize=11,textColor=colors.white,leading=14))]]
    arows.append([Paragraph("<b>Ce que nous vérifions ensemble :</b><br/>"+"<br/>".join(f"{i}. {p}" for i,p in enumerate(a['pts'],1)),cell)])
    arows.append([Paragraph(f"<b>Ce que vous recevez :</b> {a['liv']} Livré sous 48 heures. <b>Tarif : 15 000 F</b>, offert si vous commandez un pack.",cell)])
    at=Table(arows,colWidths=[170*mm]); at.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('BACKGROUND',(0,1),(-1,-1),PALE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    st+=[KeepTogether([at]),Spacer(1,8)]
    st+=[Paragraph("Les prix sont des prix de départ en francs CFA ; ils sont confirmés après un échange sur vos besoins. Les frais éventuels d'hébergement, de nom de domaine ou d'abonnement à une plateforme ne sont pas inclus et vous sont annoncés avant toute commande.",small),Spacer(1,6)]
    cta=Table([[Paragraph(f"<font color='white'><b>Prêt à commencer ?</b>  Écrivez-nous sur WhatsApp : <b>{CONTACT}</b></font>",ParagraphStyle('cta',parent=body,fontSize=11.5,textColor=colors.white))]],colWidths=[170*mm])
    cta.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),BLUE),('LEFTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    st.append(cta)

    doc=BaseDocTemplate(OUT,pagesize=A4,title=f"Solutions digitales – {d['titre']}",author=NAME)
    f1=Frame(20*mm,14*mm,170*mm,H-14*mm-52*mm,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    f2=Frame(20*mm,14*mm,170*mm,H-14*mm-19*mm,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='first',frames=[f1],onPage=cover,autoNextPageTemplate='later'),PageTemplate(id='later',frames=[f2],onPage=later)])
    doc.build(st)
    return OUT

if __name__=='__main__':
    for k in S: print(build(k))
