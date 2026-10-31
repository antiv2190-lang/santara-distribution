import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F = '/usr/share/fonts/truetype/crosextra/'
pdfmetrics.registerFont(TTFont('B', F+'Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('B-B', F+'Carlito-Bold.ttf'))
pdfmetrics.registerFont(TTFont('B-I', F+'Carlito-Italic.ttf'))
pdfmetrics.registerFontFamily('B', normal='B', bold='B-B', italic='B-I', boldItalic='B-B')

NAME = "Diadie Diawara"
CONTACT = sys.argv[1] if len(sys.argv) > 1 else "[VOTRE NUMÉRO WHATSAPP]"
OUT = sys.argv[2] if len(sys.argv) > 2 else "offre.pdf"
NAVY = colors.HexColor('#0C2340'); BLUE = colors.HexColor('#17569F'); PALE = colors.HexColor('#EAF1F9'); GREY = colors.HexColor('#52627A'); LINE = colors.HexColor('#C5D2E0'); GOLD = colors.HexColor('#F0B323')
W, H = A4

body = ParagraphStyle('b', fontName='B', fontSize=10.3, leading=13.8, textColor=NAVY)
small = ParagraphStyle('s', parent=body, fontSize=9, leading=12, textColor=GREY)
h2 = ParagraphStyle('h2', parent=body, fontName='B-B', fontSize=13, leading=16, textColor=NAVY, spaceBefore=4, spaceAfter=4)
card_t = ParagraphStyle('ct', parent=body, fontName='B-B', fontSize=12.2, leading=14.5)
price = ParagraphStyle('pr', parent=body, fontName='B-B', fontSize=15, leading=17, textColor=BLUE, alignment=TA_RIGHT)
price_s = ParagraphStyle('ps', parent=small, alignment=TA_RIGHT)
cell = ParagraphStyle('c', parent=body, fontSize=9.8, leading=13)

def cover(c, d):
    c.saveState()
    c.setFillColor(NAVY); c.rect(0, H-52*mm, W, 52*mm, stroke=0, fill=1)
    c.setFillColor(GOLD); c.rect(0, H-52*mm, W, 1.6*mm, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont('B-B', 24)
    c.drawString(20*mm, H-26*mm, "Solutions digitales sur mesure")
    c.setFont('B', 13); c.setFillColor(colors.HexColor('#BBD2EE'))
    c.drawString(20*mm, H-35*mm, "Proposition préparée pour FORCE PME PMI, Badalabougou, Bamako")
    c.setFont('B', 9.5); c.drawString(20*mm, H-44*mm, f"Préparée par {NAME}  ·  30 octobre 2026")
    footer(c, d); c.restoreState()

def later(c, d):
    c.saveState(); c.setFillColor(NAVY); c.rect(0, H-14*mm, W, 14*mm, stroke=0, fill=1)
    c.setFillColor(GOLD); c.rect(0, H-14*mm, W, 1.1*mm, stroke=0, fill=1)
    c.setFillColor(colors.white); c.setFont('B-B', 11); c.drawString(20*mm, H-9.2*mm, "Solutions digitales pour FORCE PME PMI")
    footer(c, d); c.restoreState()

def footer(c, d):
    c.setFont('B', 8.5); c.setFillColor(GREY)
    c.drawString(20*mm, 10*mm, f"{NAME}  ·  WhatsApp : {CONTACT}")
    c.drawRightString(W-20*mm, 10*mm, f"Page {d.page}")

def solution(n, title, price_txt, what, result):
    left = [Paragraph(f"<font color='#17569F'>{n}.</font> {title}", card_t), Spacer(1, 3), Paragraph(what, cell), Spacer(1, 3), Paragraph(f"<b>Pour vous :</b> {result}", cell)]
    right = [Paragraph("à partir de", price_s), Paragraph(price_txt, price)]
    t = Table([[left, right]], colWidths=[126*mm, 44*mm])
    t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BOX',(0,0),(-1,-1),0.8,LINE),('BACKGROUND',(0,0),(-1,-1),colors.white),
        ('LINEBEFORE',(0,0),(0,-1),3,BLUE),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
    return [KeepTogether([t]), Spacer(1, 6)]

story = []
story += [Spacer(1, 52*mm - 0), Paragraph("Notre constat", h2)]
obs = Table([[Paragraph("<b>Ce que nous avons observé</b><br/>"
  "• Vous êtes référencés dans les annuaires en ligne, dans la catégorie conseil et services aux entreprises, à Badalabougou.<br/>"
  "• Nous n'avons trouvé ni site internet, ni page professionnelle à votre nom : un client qui vous cherche ne voit que votre numéro et une adresse Gmail.<br/>"
  "• Vos clients vous notent déjà 4,3 sur 5 sur un annuaire en ligne (9 avis) : votre réputation est bonne, elle mérite une vitrine à sa hauteur.", cell)]], colWidths=[170*mm])
obs.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
story += [obs, Spacer(1, 8), Paragraph("Cinq solutions pour gagner des clients et du temps", h2)]

story += solution(1, "Site internet professionnel", "50 000 F",
  "Un site moderne présentant vos services, vos références et vos coordonnées, avec un bouton WhatsApp et un formulaire de demande de rendez-vous. Livré en 48 heures, adapté aux téléphones.",
  "plus de crédibilité auprès des entreprises, et des demandes qui arrivent directement sur votre WhatsApp.")
story += solution(2, "Assistant IA disponible 24 h/24", "60 000 F",
  "Un assistant intelligent sur votre site et sur WhatsApp qui répond aux questions fréquentes (services, tarifs, démarches), recueille les coordonnées des clients et vous les transmet.",
  "aucune demande perdue la nuit ou en rendez-vous, et moins de temps passé à répondre aux mêmes questions. Les frais éventuels de la plateforme vous sont annoncés avant.")
story += solution(3, "Présence en ligne et visuels", "25 000 F",
  "Fiche d'entreprise Google, page Facebook ou LinkedIn, logo et visuels professionnels pour vos publications et vos documents.",
  "une image cohérente et professionnelle partout où l'on vous cherche.")
story += solution(4, "Suivi des clients et relances automatiques", "35 000 F",
  "Un tableau de suivi de vos prospects, dossiers et rendez-vous, avec formulaire d'entrée de demande, rappels de rendez-vous et relances par WhatsApp ou e-mail.",
  "aucun client oublié, un dossier suivi du premier contact à la facture.")
story += solution(5, "Documents assistés par IA et formation de l'équipe", "30 000 F",
  "Modèles de propositions, rapports, présentations et plans d'affaires rédigés plus vite avec l'IA, et une formation pratique de votre équipe (2 heures) pour l'utiliser en toute sécurité.",
  "des livrables plus rapides pour vos clients, avec la même qualité.")

story += [Spacer(1, 2), Paragraph("Offres groupées", h2)]
packs = Table([
  [Paragraph("<b>Pack Visibilité</b><br/>Site internet + présence en ligne", cell), Paragraph("<b>65 000 F</b>", ParagraphStyle('x', parent=cell, fontSize=12, textColor=BLUE, alignment=TA_RIGHT))],
  [Paragraph("<b>Pack Croissance</b><br/>Site, assistant IA, présence en ligne et suivi des clients", cell), Paragraph("<b>150 000 F</b>", ParagraphStyle('x2', parent=cell, fontSize=12, textColor=BLUE, alignment=TA_RIGHT))],
], colWidths=[130*mm, 40*mm])
packs.setStyle(TableStyle([('BOX',(0,0),(-1,-1),0.8,LINE),('LINEBELOW',(0,0),(-1,0),0.6,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
story += [packs, Spacer(1, 9), Paragraph("Comment cela se passe", h2)]
steps = Table([[Paragraph("<b>1. Échange</b><br/>Vous nous dites ce dont vous avez besoin.", cell), Paragraph("<b>2. Prototype</b><br/>Vous voyez le résultat avant de payer.", cell), Paragraph("<b>3. Paiement en deux temps</b><br/>Moitié à la commande, moitié à la livraison.", cell), Paragraph("<b>4. Livraison</b><br/>Sous 48 h pour le site, selon la solution pour les autres.", cell)]], colWidths=[42.5*mm]*4)
steps.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,-1),PALE),('LINEAFTER',(0,0),(-2,-1),1.5,colors.white),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
story += [steps, Spacer(1, 8),
  Paragraph("Les prix indiqués sont des prix de départ en francs CFA ; ils sont confirmés après un échange sur vos besoins. Les frais éventuels d'hébergement, de nom de domaine ou d'abonnement à une plateforme ne sont pas inclus et vous sont annoncés avant toute commande. Un prototype du site peut être préparé gratuitement et sans engagement.", small),
  Spacer(1, 8),
  Table([[Paragraph(f"<font color='white'><b>Prêt à commencer ?</b>  Écrivez-nous sur WhatsApp : <b>{CONTACT}</b></font>", ParagraphStyle('cta', parent=body, fontSize=11.5, textColor=colors.white))]], colWidths=[170*mm],
        style=TableStyle([('BACKGROUND',(0,0),(-1,-1),BLUE),('LEFTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),11)]))]

doc = BaseDocTemplate(OUT, pagesize=A4, title="Solutions digitales pour FORCE PME PMI", author=NAME, leftMargin=20*mm, rightMargin=20*mm)
f1 = Frame(20*mm, 16*mm, 170*mm, H-16*mm-58*mm, id='f1', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
f2 = Frame(20*mm, 16*mm, 170*mm, H-16*mm-22*mm, id='f2', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id='first', frames=[f1], onPage=cover, autoNextPageTemplate='later'), PageTemplate(id='later', frames=[f2], onPage=later)])
story[0] = Spacer(1, 1)  # frame already starts below cover band
doc.build(story)
print('ok')
